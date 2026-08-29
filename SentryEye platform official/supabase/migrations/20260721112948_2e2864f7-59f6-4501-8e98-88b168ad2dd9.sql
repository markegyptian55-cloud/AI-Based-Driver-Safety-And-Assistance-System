-- Align sessions.source CHECK constraint with the application's SessionSource enum.
-- App uses: 'webcam', 'video-upload', 'image-upload'. Migrate legacy values first.
UPDATE public.sessions SET source = 'video-upload' WHERE source = 'video';
UPDATE public.sessions SET source = 'image-upload' WHERE source = 'image';

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_source_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_source_check
  CHECK (source = ANY (ARRAY['webcam'::text, 'video-upload'::text, 'image-upload'::text]));