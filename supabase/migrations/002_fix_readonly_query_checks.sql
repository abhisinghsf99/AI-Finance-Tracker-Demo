-- Fix two false-positive rejections in execute_readonly_query:
--
-- 1. TRIM() only strips spaces, so SQL starting with a newline failed the
--    SELECT check even though it was a valid SELECT. LLM-emitted SQL often
--    has leading whitespace/newlines.
-- 2. The keyword blocklist matched substrings, so any query referencing
--    created_at / updated_at was rejected (they contain CREATE / UPDATE).
--    \m and \M anchor to word boundaries.

CREATE OR REPLACE FUNCTION execute_readonly_query(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Only allow SELECT queries (tolerate leading whitespace of any kind)
  IF query_text !~* '^\s*select\M' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous keywords as whole words only
  IF query_text ~* '\m(drop|delete|insert|update|alter|create|truncate|grant|revoke)\M' THEN
    RAISE EXCEPTION 'Query contains disallowed keywords';
  END IF;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (' || query_text || ') t'
  INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;
