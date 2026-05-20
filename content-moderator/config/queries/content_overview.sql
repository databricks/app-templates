SELECT
  COUNT(*) AS total_submissions,
  SUM(CASE WHEN s.status = 'pending_review' THEN 1 ELSE 0 END) AS pending_count,
  SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
  SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
  SUM(CASE WHEN s.status = 'revision_requested' THEN 1 ELSE 0 END) AS revision_count,
  ROUND(COALESCE(AVG(a.compliance_score), 0), 0) AS avg_compliance_score
FROM content_moderation.app_data.submissions s
LEFT JOIN (
  SELECT DISTINCT submission_id, FIRST_VALUE(compliance_score) OVER (
    PARTITION BY submission_id ORDER BY analyzed_at DESC
  ) AS compliance_score
  FROM content_moderation.app_data.ai_analyses
) a ON s.id = a.submission_id
