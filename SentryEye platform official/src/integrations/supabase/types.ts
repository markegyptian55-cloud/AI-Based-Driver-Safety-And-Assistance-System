export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string
          actor_role: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: number
          ip: unknown
          metadata: Json
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: number
          ip?: unknown
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: number
          ip?: unknown
          metadata?: Json
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      benchmark_runs: {
        Row: {
          best_fps: number | null
          best_latency_p95_ms: number | null
          best_model_id: string | null
          best_model_label: string | null
          created_at: string
          device: Json
          frame_count: number
          frame_source: string
          id: string
          notes: string | null
          results: Json
          user_id: string
        }
        Insert: {
          best_fps?: number | null
          best_latency_p95_ms?: number | null
          best_model_id?: string | null
          best_model_label?: string | null
          created_at?: string
          device?: Json
          frame_count?: number
          frame_source?: string
          id?: string
          notes?: string | null
          results?: Json
          user_id: string
        }
        Update: {
          best_fps?: number | null
          best_latency_p95_ms?: number | null
          best_model_id?: string | null
          best_model_label?: string | null
          created_at?: string
          device?: Json
          frame_count?: number
          frame_source?: string
          id?: string
          notes?: string | null
          results?: Json
          user_id?: string
        }
        Relationships: []
      }
      detection_events: {
        Row: {
          bbox: Json | null
          class_id: number
          class_label: string
          confidence: number
          created_at: string
          id: number
          risk_level: string | null
          semantic_tag: string | null
          session_id: string
          t_ms: number
          thumbnail_path: string | null
          user_id: string
        }
        Insert: {
          bbox?: Json | null
          class_id: number
          class_label: string
          confidence: number
          created_at?: string
          id?: number
          risk_level?: string | null
          semantic_tag?: string | null
          session_id: string
          t_ms: number
          thumbnail_path?: string | null
          user_id: string
        }
        Update: {
          bbox?: Json | null
          class_id?: number
          class_label?: string
          confidence?: number
          created_at?: string
          id?: number
          risk_level?: string | null
          semantic_tag?: string | null
          session_id?: string
          t_ms?: number
          thumbnail_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "detection_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostics_shares: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          payload: Json
          redaction_summary: string[]
          token: string
          view_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          payload: Json
          redaction_summary?: string[]
          token: string
          view_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          payload?: Json
          redaction_summary?: string[]
          token?: string
          view_count?: number
        }
        Relationships: []
      }
      driver_daily_stats: {
        Row: {
          completed_shifts: number
          critical_events: number
          date: string
          driver_id: string
          drowsiness_events: number
          drowsiness_rate: number
          event_rate: number
          eyes_closed_events: number
          id: string
          monitored_seconds: number
          organization_id: string
          phone_usage_events: number
          risk_level: Database["public"]["Enums"]["risk_level"]
          safety_score: number
          total_events: number
          updated_at: string
          user_id: string
          yawning_events: number
        }
        Insert: {
          completed_shifts?: number
          critical_events?: number
          date: string
          driver_id: string
          drowsiness_events?: number
          drowsiness_rate?: number
          event_rate?: number
          eyes_closed_events?: number
          id?: string
          monitored_seconds?: number
          organization_id: string
          phone_usage_events?: number
          risk_level?: Database["public"]["Enums"]["risk_level"]
          safety_score?: number
          total_events?: number
          updated_at?: string
          user_id: string
          yawning_events?: number
        }
        Update: {
          completed_shifts?: number
          critical_events?: number
          date?: string
          driver_id?: string
          drowsiness_events?: number
          drowsiness_rate?: number
          event_rate?: number
          eyes_closed_events?: number
          id?: string
          monitored_seconds?: number
          organization_id?: string
          phone_usage_events?: number
          risk_level?: Database["public"]["Enums"]["risk_level"]
          safety_score?: number
          total_events?: number
          updated_at?: string
          user_id?: string
          yawning_events?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_daily_stats_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_daily_stats_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          driver_code: string
          employee_ref: string | null
          full_name: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          driver_code: string
          employee_ref?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          driver_code?: string
          employee_ref?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_notes: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          manager_id: string
          note: string
          organization_id: string
          shift_id: string | null
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          manager_id: string
          note: string
          organization_id: string
          shift_id?: string | null
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          manager_id?: string
          note?: string
          organization_id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manager_notes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          created_at: string
          duration_sec: number | null
          height: number | null
          id: string
          kind: string
          metadata: Json
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          height?: number | null
          id?: string
          kind: string
          metadata?: Json
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          height?: number | null
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
          width?: number | null
        }
        Relationships: []
      }
      model_registry: {
        Row: {
          checksum: string | null
          created_at: string
          engine_kind: string
          file_path: string | null
          file_size_bytes: number | null
          framework: string
          head_format: string
          id: string
          imgsz: number
          is_active: boolean
          labels: Json
          map50: number | null
          map50_95: number | null
          name: string
          notes: string | null
          num_classes: number
          postprocess_config: Json
          precision_score: number | null
          recall_score: number | null
          semantic_map: Json
          trained_at: string | null
          updated_at: string
          version: string
        }
        Insert: {
          checksum?: string | null
          created_at?: string
          engine_kind: string
          file_path?: string | null
          file_size_bytes?: number | null
          framework: string
          head_format: string
          id?: string
          imgsz?: number
          is_active?: boolean
          labels: Json
          map50?: number | null
          map50_95?: number | null
          name: string
          notes?: string | null
          num_classes: number
          postprocess_config?: Json
          precision_score?: number | null
          recall_score?: number | null
          semantic_map?: Json
          trained_at?: string | null
          updated_at?: string
          version: string
        }
        Update: {
          checksum?: string | null
          created_at?: string
          engine_kind?: string
          file_path?: string | null
          file_size_bytes?: number | null
          framework?: string
          head_format?: string
          id?: string
          imgsz?: number
          is_active?: boolean
          labels?: Json
          map50?: number | null
          map50_95?: number | null
          name?: string
          notes?: string | null
          num_classes?: number
          postprocess_config?: Json
          precision_score?: number | null
          recall_score?: number | null
          semantic_map?: Json
          trained_at?: string | null
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["fleet_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["fleet_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["fleet_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          scoring_config: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          scoring_config?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          scoring_config?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      safety_events: {
        Row: {
          client_event_id: string
          confidence: number
          created_at: string
          driver_id: string
          duration_seconds: number
          event_type: string
          evidence_reference: string | null
          id: string
          model_version: string | null
          organization_id: string
          severity: string
          shift_id: string
          started_at: string
          user_id: string
        }
        Insert: {
          client_event_id: string
          confidence?: number
          created_at?: string
          driver_id: string
          duration_seconds?: number
          event_type: string
          evidence_reference?: string | null
          id?: string
          model_version?: string | null
          organization_id: string
          severity?: string
          shift_id: string
          started_at?: string
          user_id: string
        }
        Update: {
          client_event_id?: string
          confidence?: number
          created_at?: string
          driver_id?: string
          duration_seconds?: number
          event_type?: string
          evidence_reference?: string | null
          id?: string
          model_version?: string | null
          organization_id?: string
          severity?: string
          shift_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          alerts_critical: number
          alerts_high: number
          alerts_low: number
          alerts_medium: number
          analysed_frames: number
          avg_eye_closure_ms: number | null
          avg_fps: number | null
          avg_latency_ms: number | null
          closed_eye_events: number
          closed_eye_frames: number
          device_info: Json
          driver_id: string | null
          driver_label: string | null
          drop_rate: number | null
          dropped_frames: number
          duration_sec: number | null
          ended_at: string | null
          engine_kind: string | null
          eye_closure_ratio: number | null
          fatigue_level: string | null
          fps_p50: number | null
          fps_p95: number | null
          frames_processed: number
          id: string
          infer_p50_ms: number | null
          infer_p95_ms: number | null
          latency_p50_ms: number | null
          latency_p95_ms: number | null
          longest_eye_closure_ms: number | null
          max_risk_level: string | null
          media_asset_id: string | null
          model_id: string | null
          notes: string | null
          open_eye_frames: number
          perclos: number | null
          pipeline: Json | null
          processing_time_ms: number | null
          provider: string
          risk_score: number | null
          safety_score: number | null
          source: string
          started_at: string
          status: string
          total_alerts: number
          total_frames: number
          user_id: string
          worst_stall_ms: number | null
          yawn_events: number
          yawn_frames: number
          yawn_per_min: number | null
        }
        Insert: {
          alerts_critical?: number
          alerts_high?: number
          alerts_low?: number
          alerts_medium?: number
          analysed_frames?: number
          avg_eye_closure_ms?: number | null
          avg_fps?: number | null
          avg_latency_ms?: number | null
          closed_eye_events?: number
          closed_eye_frames?: number
          device_info?: Json
          driver_id?: string | null
          driver_label?: string | null
          drop_rate?: number | null
          dropped_frames?: number
          duration_sec?: number | null
          ended_at?: string | null
          engine_kind?: string | null
          eye_closure_ratio?: number | null
          fatigue_level?: string | null
          fps_p50?: number | null
          fps_p95?: number | null
          frames_processed?: number
          id?: string
          infer_p50_ms?: number | null
          infer_p95_ms?: number | null
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          longest_eye_closure_ms?: number | null
          max_risk_level?: string | null
          media_asset_id?: string | null
          model_id?: string | null
          notes?: string | null
          open_eye_frames?: number
          perclos?: number | null
          pipeline?: Json | null
          processing_time_ms?: number | null
          provider: string
          risk_score?: number | null
          safety_score?: number | null
          source: string
          started_at?: string
          status?: string
          total_alerts?: number
          total_frames?: number
          user_id: string
          worst_stall_ms?: number | null
          yawn_events?: number
          yawn_frames?: number
          yawn_per_min?: number | null
        }
        Update: {
          alerts_critical?: number
          alerts_high?: number
          alerts_low?: number
          alerts_medium?: number
          analysed_frames?: number
          avg_eye_closure_ms?: number | null
          avg_fps?: number | null
          avg_latency_ms?: number | null
          closed_eye_events?: number
          closed_eye_frames?: number
          device_info?: Json
          driver_id?: string | null
          driver_label?: string | null
          drop_rate?: number | null
          dropped_frames?: number
          duration_sec?: number | null
          ended_at?: string | null
          engine_kind?: string | null
          eye_closure_ratio?: number | null
          fatigue_level?: string | null
          fps_p50?: number | null
          fps_p95?: number | null
          frames_processed?: number
          id?: string
          infer_p50_ms?: number | null
          infer_p95_ms?: number | null
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          longest_eye_closure_ms?: number | null
          max_risk_level?: string | null
          media_asset_id?: string | null
          model_id?: string | null
          notes?: string | null
          open_eye_frames?: number
          perclos?: number | null
          pipeline?: Json | null
          processing_time_ms?: number | null
          provider?: string
          risk_score?: number | null
          safety_score?: number | null
          source?: string
          started_at?: string
          status?: string
          total_alerts?: number
          total_frames?: number
          user_id?: string
          worst_stall_ms?: number | null
          yawn_events?: number
          yawn_frames?: number
          yawn_per_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_reports: {
        Row: {
          avg_confidence: number
          critical_events: number
          driver_id: string
          drowsiness_events: number
          drowsiness_rate: number
          event_rate: number
          execution_provider: string | null
          eyes_closed_events: number
          factors: Json
          finalized_at: string
          generated_at: string
          id: string
          model_name: string | null
          model_version: string | null
          monitored_seconds: number
          organization_id: string
          other_events: number
          phone_usage_events: number
          recommendation: string
          risk_level: Database["public"]["Enums"]["risk_level"]
          safety_score: number
          shift_id: string
          total_events: number
          user_id: string
          yawning_events: number
        }
        Insert: {
          avg_confidence?: number
          critical_events?: number
          driver_id: string
          drowsiness_events?: number
          drowsiness_rate?: number
          event_rate?: number
          execution_provider?: string | null
          eyes_closed_events?: number
          factors?: Json
          finalized_at?: string
          generated_at?: string
          id?: string
          model_name?: string | null
          model_version?: string | null
          monitored_seconds?: number
          organization_id: string
          other_events?: number
          phone_usage_events?: number
          recommendation?: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          safety_score?: number
          shift_id: string
          total_events?: number
          user_id: string
          yawning_events?: number
        }
        Update: {
          avg_confidence?: number
          critical_events?: number
          driver_id?: string
          drowsiness_events?: number
          drowsiness_rate?: number
          event_rate?: number
          execution_provider?: string | null
          eyes_closed_events?: number
          factors?: Json
          finalized_at?: string
          generated_at?: string
          id?: string
          model_name?: string | null
          model_version?: string | null
          monitored_seconds?: number
          organization_id?: string
          other_events?: number
          phone_usage_events?: number
          recommendation?: string
          risk_level?: Database["public"]["Enums"]["risk_level"]
          safety_score?: number
          shift_id?: string
          total_events?: number
          user_id?: string
          yawning_events?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_reports_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          client_shift_id: string
          created_at: string
          device_info: Json
          driver_id: string
          duration_seconds: number
          ended_at: string | null
          execution_provider: string | null
          finalized_at: string | null
          id: string
          model_id: string | null
          model_imgsz: number | null
          model_name: string | null
          model_version: string | null
          monitored_seconds: number
          organization_id: string
          precision: string | null
          started_at: string
          status: Database["public"]["Enums"]["shift_status"]
          sync_status: Database["public"]["Enums"]["sync_status"]
          user_id: string
        }
        Insert: {
          client_shift_id: string
          created_at?: string
          device_info?: Json
          driver_id: string
          duration_seconds?: number
          ended_at?: string | null
          execution_provider?: string | null
          finalized_at?: string | null
          id?: string
          model_id?: string | null
          model_imgsz?: number | null
          model_name?: string | null
          model_version?: string | null
          monitored_seconds?: number
          organization_id: string
          precision?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          sync_status?: Database["public"]["Enums"]["sync_status"]
          user_id: string
        }
        Update: {
          client_shift_id?: string
          created_at?: string
          device_info?: Json
          driver_id?: string
          duration_seconds?: number
          ended_at?: string | null
          execution_provider?: string | null
          finalized_at?: string | null
          id?: string
          model_id?: string | null
          model_imgsz?: number | null
          model_name?: string | null
          model_version?: string | null
          monitored_seconds?: number
          organization_id?: string
          precision?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          sync_status?: Database["public"]["Enums"]["sync_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_metrics: {
        Row: {
          active_sessions: number | null
          avg_latency_ms: number | null
          backend_status: string | null
          cpu_pct: number | null
          db_status: string | null
          extra: Json
          fps: number | null
          gpu_pct: number | null
          id: number
          queue_len: number | null
          ram_mb: number | null
          ts: string
          vram_mb: number | null
          ws_status: string | null
        }
        Insert: {
          active_sessions?: number | null
          avg_latency_ms?: number | null
          backend_status?: string | null
          cpu_pct?: number | null
          db_status?: string | null
          extra?: Json
          fps?: number | null
          gpu_pct?: number | null
          id?: number
          queue_len?: number | null
          ram_mb?: number | null
          ts?: string
          vram_mb?: number | null
          ws_status?: string | null
        }
        Update: {
          active_sessions?: number | null
          avg_latency_ms?: number | null
          backend_status?: string | null
          cpu_pct?: number | null
          db_status?: string | null
          extra?: Json
          fps?: number | null
          gpu_pct?: number | null
          id?: number
          queue_len?: number | null
          ram_mb?: number | null
          ts?: string
          vram_mb?: number | null
          ws_status?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          alarm_enabled: boolean
          alarm_volume: number
          browser_notifications_enabled: boolean
          calibration_profile: Json | null
          calibration_sync_enabled: boolean
          calibration_updated_at: string | null
          drowsy_perclos_threshold: number
          eye_closed_ms_threshold: number
          fallback_enabled: boolean
          fallback_max_latency_ms: number
          fallback_min_fps: number
          inference_provider: string
          remote_api_url: string | null
          selected_model_id: string | null
          theme: string
          updated_at: string
          user_id: string
          yawn_rate_per_min_threshold: number
        }
        Insert: {
          alarm_enabled?: boolean
          alarm_volume?: number
          browser_notifications_enabled?: boolean
          calibration_profile?: Json | null
          calibration_sync_enabled?: boolean
          calibration_updated_at?: string | null
          drowsy_perclos_threshold?: number
          eye_closed_ms_threshold?: number
          fallback_enabled?: boolean
          fallback_max_latency_ms?: number
          fallback_min_fps?: number
          inference_provider?: string
          remote_api_url?: string | null
          selected_model_id?: string | null
          theme?: string
          updated_at?: string
          user_id: string
          yawn_rate_per_min_threshold?: number
        }
        Update: {
          alarm_enabled?: boolean
          alarm_volume?: number
          browser_notifications_enabled?: boolean
          calibration_profile?: Json | null
          calibration_sync_enabled?: boolean
          calibration_updated_at?: string | null
          drowsy_perclos_threshold?: number
          eye_closed_ms_threshold?: number
          fallback_enabled?: boolean
          fallback_max_latency_ms?: number
          fallback_min_fps?: number
          inference_provider?: string
          remote_api_url?: string | null
          selected_model_id?: string | null
          theme?: string
          updated_at?: string
          user_id?: string
          yawn_rate_per_min_threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_selected_model_id_fkey"
            columns: ["selected_model_id"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_audit_row: { Args: { _actor: string }; Returns: boolean }
      current_fleet_role: {
        Args: never
        Returns: Database["public"]["Enums"]["fleet_role"]
      }
      current_org_id: { Args: never; Returns: string }
      current_user_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      finalize_shift: {
        Args: { _monitored_seconds?: number; _shift_id: string }
        Returns: string
      }
      fleet_role_for_email: {
        Args: { _email: string }
        Returns: Database["public"]["Enums"]["fleet_role"]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_manager: { Args: { _org: string }; Returns: boolean }
      is_reserved_manager: { Args: never; Returns: boolean }
      manager_audit_feed: {
        Args: {
          _action?: string
          _from?: string
          _limit?: number
          _offset?: number
          _to?: string
        }
        Returns: {
          action: string
          actor_email: string
          actor_id: string
          actor_role: string
          created_at: string
          id: number
          metadata: Json
          target_id: string
          target_type: string
          total_count: number
        }[]
      }
      my_driver_id: { Args: never; Returns: string }
      purge_expired_diagnostics_shares: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "researcher" | "operator" | "viewer"
      fleet_role: "driver" | "manager" | "admin"
      risk_level: "low" | "moderate" | "high" | "critical"
      shift_status: "active" | "ending" | "completed" | "cancelled"
      sync_status:
        | "local"
        | "pending_sync"
        | "syncing"
        | "synced"
        | "sync_error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "researcher", "operator", "viewer"],
      fleet_role: ["driver", "manager", "admin"],
      risk_level: ["low", "moderate", "high", "critical"],
      shift_status: ["active", "ending", "completed", "cancelled"],
      sync_status: ["local", "pending_sync", "syncing", "synced", "sync_error"],
    },
  },
} as const
