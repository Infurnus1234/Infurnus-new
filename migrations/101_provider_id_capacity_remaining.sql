-- A width upgrade abandons the unused shorter range. Count only values the
-- allocator can actually issue at the activated width, including its next value.
CREATE OR REPLACE VIEW provider_id_capacity AS
SELECT id_length, version, allocations_enabled, trunc(last_value)::text AS last_value,
 trunc(greatest(0::numeric,
   power(10::numeric,id_length) - greatest(last_value+1,power(10::numeric,id_length-1))
 ))::text AS remaining,
 (last_value>=power(10::numeric,id_length)-1) AS exhausted
FROM provider_id_allocator;
