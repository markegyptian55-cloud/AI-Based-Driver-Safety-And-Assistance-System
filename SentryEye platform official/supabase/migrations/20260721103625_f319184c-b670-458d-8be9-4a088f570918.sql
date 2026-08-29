
-- MEDIA
CREATE POLICY "media: users read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "media: users write own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "media: users update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "media: users delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "media: researchers admins read all" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND public.has_any_role(auth.uid(), ARRAY['admin','researcher']::public.app_role[]));

-- THUMBNAILS
CREATE POLICY "thumbs: users read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "thumbs: users write own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "thumbs: users delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'thumbnails' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "thumbs: researchers admins read all" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'thumbnails' AND public.has_any_role(auth.uid(), ARRAY['admin','researcher']::public.app_role[]));

-- MODELS
CREATE POLICY "models: authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'models');
CREATE POLICY "models: admins manage" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'));
