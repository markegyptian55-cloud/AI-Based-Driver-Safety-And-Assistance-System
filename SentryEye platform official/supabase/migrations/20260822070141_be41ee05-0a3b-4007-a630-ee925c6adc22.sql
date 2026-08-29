UPDATE public.model_registry
SET file_path = postprocess_config->>'cpuFileUrl',
    file_size_bytes = (postprocess_config->>'cpuFileSizeBytes')::bigint,
    postprocess_config = (postprocess_config - 'cpuFileUrl' - 'cpuFileSizeBytes') || jsonb_build_object('exportPrecision','fp32'),
    updated_at = now()
WHERE postprocess_config ? 'cpuFileUrl';