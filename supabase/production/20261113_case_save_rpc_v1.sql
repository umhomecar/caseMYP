-- CaseMYP-New: transactional one-call create/update for the two operations accounts.
-- Additive only. Does not change queue/audit triggers, table schemas, old database, or data.
-- Intentionally SECURITY INVOKER; only backend service_role receives EXECUTE privilege.
CREATE OR REPLACE FUNCTION public.casemyp_save_case_v1(
  p_operation text,
  p_payload jsonb,
  p_actor_userid text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $case$
DECLARE
  v_actor record;
  v_case public.cases%ROWTYPE;
  v_before public.cases%ROWTYPE;
  v_caseid text;
  v_prefix text;
  v_max_caseid text;
  v_prev_version integer;
  v_expected_version integer;
  v_assigned text;
  v_actor_name text;
  v_contact_digits text;
  v_candidate_digits text;
  v_customer_normal text;
  v_duplicates jsonb;
  v_note text;
  v_sent text;
  v_sender text;
  v_changed_sales boolean := false;
  v_ts text := to_char(clock_timestamp() AT TIME ZONE 'Asia/Bangkok','DD/MM/YYYY HH24:MI:SS');
  v_i integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_operation NOT IN ('create','update') THEN
    RETURN jsonb_build_object('success',false,'error','ข้อมูลที่ส่งมาไม่ถูกต้อง');
  END IF;
  SELECT u.userid,u.username,u.name,u.role,u.status INTO v_actor
    FROM public.users AS u WHERE u.userid=p_actor_userid AND u.status='active';
  IF NOT FOUND OR (v_actor.role <> 'Admin' AND NOT (v_actor.role='Sales' AND v_actor.username='art')) THEN
    RETURN jsonb_build_object('success',false,'error','ไม่มีสิทธิ์บันทึกเคส');
  END IF;
  v_actor_name:=coalesce(nullif(v_actor.name,''),'ระบบ');

  IF p_operation='create' THEN
    IF nullif(btrim(p_payload->>'customername'),'') IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','กรุณากรอกชื่อลูกค้า');
    END IF;
    v_prefix:=coalesce(nullif(p_payload->>'casePrefix',''),
                       to_char(clock_timestamp() AT TIME ZONE 'Asia/Bangkok','YYMM'));
    IF v_prefix !~ '^[0-9]{4}$' OR
       (nullif(p_payload->>'caseid','') IS NOT NULL
         AND (p_payload->>'caseid') !~ '^[0-9]{7}$') THEN
      RETURN jsonb_build_object('success',false,'error','รหัสเคสไม่ถูกต้อง');
    END IF;

    -- Duplicate check inside the same server request, preserving explicit user confirmation.
    IF NOT coalesce((p_payload->>'duplicateConfirmed')::boolean,false) THEN
      v_contact_digits:=regexp_replace(translate(coalesce(p_payload->>'contact',''),
        '๐๑๒๓๔๕๖๗๘๙','0123456789'),'[^0-9]','','g');
      v_customer_normal:=lower(regexp_replace(coalesce(p_payload->>'customername',''),
        '[[:space:][:punct:]]+','','g'));
      SELECT coalesce(jsonb_agg(to_jsonb(sub)), '[]'::jsonb) INTO v_duplicates
      FROM (
        SELECT c.caseid,c.customername,c.contact
        FROM public.cases AS c
        WHERE c.deleted_at IS NULL AND (
          (nullif(p_payload->>'previewId','') IS NOT NULL
            AND c.caseid=(p_payload->>'previewId'))
          OR (length(v_contact_digits)>=6
            AND regexp_replace(translate(coalesce(c.contact,''),'๐๑๒๓๔๕๖๗๘๙','0123456789'),'[^0-9]','','g')=v_contact_digits)
          OR (length(v_contact_digits)>=3 AND length(v_customer_normal)>=3
            AND lower(regexp_replace(coalesce(c.customername,''),'[[:space:][:punct:]]+','','g'))=v_customer_normal
            AND position(v_contact_digits IN regexp_replace(translate(coalesce(c.contact,''),'๐๑๒๓๔๕๖๗๘๙','0123456789'),'[^0-9]','','g'))>0)
        )
        ORDER BY c.updatedat DESC NULLS LAST
        LIMIT 10
      ) sub;
      IF jsonb_array_length(v_duplicates)>0 THEN
        RETURN jsonb_build_object('success',false,'duplicates',v_duplicates,'error','พบเคสที่อาจซ้ำ กรุณาตรวจสอบก่อน');
      END IF;
    END IF;

    -- Serialize ID allocation among this RPC's callers, and still handle old-client collisions.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('casemyp-case-id:'||v_prefix));
    SELECT c.caseid INTO v_max_caseid
      FROM public.cases AS c
      WHERE c.caseid LIKE v_prefix||'%' AND c.caseid ~ '^[0-9]{7}$'
      ORDER BY c.caseid DESC LIMIT 1;
    v_assigned:=coalesce(nullif(btrim(p_payload->>'sales'),''),'รอมอบหมาย');
    v_sent:=coalesce(nullif(p_payload->>'sent',''),'ปกติ');

    FOR v_i IN 0..7 LOOP
      v_caseid:=coalesce(nullif(p_payload->>'caseid',''),
        v_prefix||lpad((coalesce(nullif(substring(v_max_caseid FROM 5),'')::int,0)+v_i+1)::text,3,'0'));
      BEGIN
        INSERT INTO public.cases(
          caseid,customername,contact,report,status,sales,createdat,updatedat,
          sent,attachment,version
        ) VALUES(
          v_caseid,p_payload->>'customername',coalesce(p_payload->>'contact',''),
          coalesce(p_payload->>'report',''),coalesce(nullif(p_payload->>'status',''),'รอข้อมูล'),
          v_assigned,coalesce(nullif(p_payload->>'createdat',''),v_ts),
          coalesce(nullif(p_payload->>'updatedat',''),coalesce(nullif(p_payload->>'createdat',''),v_ts)),
          v_sent,coalesce(p_payload->>'attachment',''),1
        ) RETURNING * INTO v_case;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF nullif(p_payload->>'caseid','') IS NOT NULL OR v_i=7 THEN
          RETURN jsonb_build_object('success',false,'error','รหัสเคสซ้ำ กรุณาลองใหม่');
        END IF;
      END;
    END LOOP;
    IF v_case.caseid IS NULL THEN
      RETURN jsonb_build_object('success',false,'error','ไม่สามารถสร้างเคสได้');
    END IF;
    -- Database trigger still owns page queue selection; read actual assigned salesperson.
    v_assigned:=coalesce(v_case.sales,'รอมอบหมาย');
    v_sender:=CASE WHEN p_payload->>'lineSender' IN ('เกมส์','อาท')
      THEN p_payload->>'lineSender' ELSE '' END;
    INSERT INTO public.history(caseid,sales,action,detail,createdat) VALUES(
      v_case.caseid,v_actor_name,'เพิ่มเคส',
      'เพิ่มเคสใหม่: '||v_case.customername||
      CASE WHEN v_assigned='รอมอบหมาย' THEN ' — รอมอบหมายเซลส์'
           ELSE ' — มอบหมายให้ '||v_assigned END||
      CASE WHEN v_sender<>'' THEN ' | ผู้ส่ง LINE: '||v_sender ELSE '' END,
      v_ts
    );
    v_note:=nullif(btrim(p_payload->>'note'),'');
    IF v_note IS NOT NULL THEN
      INSERT INTO public.case_notes(id,caseid,sales,note,createdat,deletedat) VALUES(
        nextval('public.case_notes_id_seq'::regclass),
        v_case.caseid,v_actor_name,v_note,v_case.createdat,NULL
      );
      INSERT INTO public.history(caseid,sales,action,detail,createdat)
      VALUES(v_case.caseid,v_actor_name,'📝 Note','📝 Note: '||v_note,v_ts);
    END IF;
    IF v_assigned <> 'รอมอบหมาย' THEN
      INSERT INTO public.notifications(id,sales,caseid,message,createdat,status)
      VALUES(nextval('public.notifications_id_seq'::regclass),v_assigned,v_case.caseid,
        '📋 ได้รับมอบหมายเคสใหม่ '||v_case.caseid||' ('||v_case.customername||')',v_ts,'unread');
    END IF;
    RETURN jsonb_build_object('success',true,'caseId',v_case.caseid,'sales',v_assigned,
       'unassigned',v_assigned='รอมอบหมาย','historySaved',true,
       'noteSaved',true,'notificationSaved',true);
  END IF;

  -- Update branch: row lock and version check preserve current optimistic concurrency.
  v_caseid:=nullif(p_payload->>'caseid','');
  IF v_caseid IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','ไม่มีรหัสเคส');
  END IF;
  SELECT * INTO v_before FROM public.cases
    WHERE caseid=v_caseid AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','ไม่พบเคส หรือเคสอยู่ในถังขยะแล้ว');
  END IF;
  v_prev_version:=coalesce(v_before.version,1);
  v_expected_version:=coalesce(nullif(p_payload->>'expectedVersion','')::int,v_prev_version);
  IF v_expected_version<>v_prev_version THEN
    RETURN jsonb_build_object('success',false,'conflict',true,
      'error','เคสนี้ถูกแก้จากอุปกรณ์อื่น กรุณารีเฟรชก่อนบันทึก');
  END IF;
  v_changed_sales:=v_actor.role='Admin'
     AND nullif(btrim(p_payload->>'newSales'),'') IS NOT NULL
     AND p_payload->>'newSales' IS DISTINCT FROM v_before.sales;
  UPDATE public.cases AS c SET
    updatedat=v_ts,version=v_prev_version+1,
    status=CASE WHEN p_payload ? 'status' THEN p_payload->>'status' ELSE c.status END,
    report=CASE WHEN p_payload ? 'report' THEN p_payload->>'report' ELSE c.report END,
    customername=CASE WHEN p_payload ? 'customername' THEN p_payload->>'customername' ELSE c.customername END,
    contact=CASE WHEN p_payload ? 'contact' THEN p_payload->>'contact' ELSE c.contact END,
    sent=CASE WHEN p_payload ? 'sent' THEN p_payload->>'sent' ELSE c.sent END,
    attachment=CASE WHEN p_payload ? 'attachment' THEN p_payload->>'attachment' ELSE c.attachment END,
    sales=CASE WHEN v_changed_sales THEN p_payload->>'newSales'
      WHEN p_payload ? 'sales' THEN p_payload->>'sales' ELSE c.sales END,
    assigned_at=CASE WHEN v_changed_sales THEN clock_timestamp() ELSE c.assigned_at END,
    assigned_by=CASE WHEN v_changed_sales THEN v_actor_name ELSE c.assigned_by END
  WHERE c.caseid=v_caseid AND c.deleted_at IS NULL AND c.version=v_prev_version
  RETURNING * INTO v_case;
  IF v_case.caseid IS NULL THEN
    RETURN jsonb_build_object('success',false,'conflict',true,
      'error','เคสนี้ถูกแก้จากอุปกรณ์อื่น กรุณารีเฟรชก่อนบันทึก');
  END IF;
  INSERT INTO public.history(caseid,sales,action,detail,createdat)
  VALUES(v_caseid,v_actor_name,'แก้ไข',
    coalesce(nullif(p_payload->>'detail',''),'บันทึกข้อมูล'),v_ts);
  IF v_changed_sales THEN
    INSERT INTO public.history(caseid,sales,action,detail,createdat)
    VALUES(v_caseid,v_actor_name,'มอบหมายเคส',
       'มอบหมาย '||coalesce(v_before.sales,'รอมอบหมาย')||' → '||p_payload->>'newSales',v_ts);
    IF p_payload->>'newSales'<>'รอมอบหมาย' THEN
      INSERT INTO public.notifications(id,sales,caseid,message,createdat,status)
      VALUES(nextval('public.notifications_id_seq'::regclass),p_payload->>'newSales',v_caseid,
        '📋 ได้รับมอบหมายเคส '||v_caseid||' ('||coalesce(v_case.customername,'')||')',v_ts,'unread');
    END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'data',to_jsonb(v_case),
    'historySaved',true,'notificationSaved',true);
END;
$case$;

REVOKE ALL ON FUNCTION public.casemyp_save_case_v1(text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.casemyp_save_case_v1(text,jsonb,text) FROM anon;
REVOKE ALL ON FUNCTION public.casemyp_save_case_v1(text,jsonb,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.casemyp_save_case_v1(text,jsonb,text) TO service_role;
