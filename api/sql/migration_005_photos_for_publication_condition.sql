CREATE OR REPLACE VIEW photos_for_publication AS
SELECT c.owner_kind, c.owner_id, p."position", p.s3_key
FROM photo_groups g
JOIN photo_collages c ON c.group_id=g.id
JOIN photos p ON p.collage_id=c.id
WHERE p.state='uploaded' AND (
   (c.owner_kind='smart_part' AND g.id='ae697d8d-e803-42c4-9982-ecefbf8a8cdf'::uuid)
   OR (c.owner_kind='instance' AND EXISTS (
        SELECT 1 FROM uchet_ext.items i WHERE i.id = c.owner_id::int AND (
            (g.id='3cf67240-7597-451a-8ec1-fb097afdeb88'::uuid AND i.condition='personal')
         OR (g.id='a1790194-efa0-4dda-bed4-d8bc15b3b624'::uuid AND i.condition='defect'))))
)
ORDER BY c.owner_kind, c.owner_id, p."position";
