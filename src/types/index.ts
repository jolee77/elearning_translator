// ─── 공통 ───────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'designer'

export type ProjectStatus =
  | 'uploaded'
  | 'extracted'
  | 'spelling'
  | 'spelling_done'
  | 'translating'
  | 'translated'
  | 'verifying'
  | 'verified'
  | 'expert_review'
  | 'done'

export type SlideType =
  | 'guide'
  | 'intro'
  | 'divider'
  | 'outro'
  | 'quiz'
  | 'apply'
  | 'lesson'
  | 'content'

export type ExpertReviewStatus = 'pending' | 'in_progress' | 'done'

export type ExpertReviewItemStatus = 'pending' | 'approved' | 'rejected' | 'reviewed'

export type VerificationApplyStatus = 'pending' | 'applied' | 'skipped'

export type ChangeLogAction =
  | 'project_created'
  | 'pptx_uploaded'
  | 'extraction_done'
  | 'spelling_applied'
  | 'translation_done'
  | 'verification_applied'
  | 'expert_review_sent'
  | 'expert_review_done'
  | 'download'

// ─── PPTX 추출 데이터 ───────────────────────────────────────────────────────

export interface SlideTextBox {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  font_size?: number
}

// ─── DB 테이블 ──────────────────────────────────────────────────────────────

export interface Profile {
  id: string
  email: string
  name: string
  role: UserRole
  created_at: string
  updated_at: string
}

export interface SettingRow {
  id: number
  key: string
  value: string | null
}

export interface Settings {
  claude_api_key: string | null
  default_target_lang: string
}

export interface Project {
  id: string
  created_by: string
  title: string
  status: ProjectStatus
  source_pptx_url: string | null
  source_pptx_name: string | null
  vn_pptx: string | null
  target_lang: string
  created_at: string
  updated_at: string
}

export interface Slide {
  id: string
  project_id: string
  slide_num: number
  slide_type: SlideType
  screen_num: string | null
  course_name: string | null
  chapter_name: string | null
  current_section: string | null
  screen_text: SlideTextBox[] | null
  screen_desc: string | null
  image_nums: string | null
  narration: string | null
  created_at: string
}

export interface SpellingResult {
  id: string
  project_id: string
  slide_id: string
  field: string
  original: string
  suggestion: string
  applied: boolean
  skipped: boolean
  issues: SpellingIssue[]
  created_at: string
}

export interface SpellingIssue {
  type: string
  message: string
  offset?: number
  length?: number
}

export interface Translation {
  id: string
  project_id: string
  slide_id: string
  field: string
  source: string
  vi_text: string
  cpm: number | null
  vi_wpm: number | null
  created_at: string
  updated_at: string
}

export interface Verification {
  id: string
  project_id: string
  slide_id: string
  translation_id: string
  back_translation: string
  score: number | null
  issues: string | null
  apply_status: VerificationApplyStatus
  created_at: string
}

export interface ExpertReview {
  id: string
  project_id: string
  token: string
  status: ExpertReviewStatus
  expert_name: string | null
  expert_email: string | null
  message: string | null
  created_at: string
}

export interface ExpertReviewProjectInfo {
  id: string
  title: string
  target_lang: string
}

export interface ExpertReviewSlideInfo {
  id: string
  slide_num: number
  screen_num: string | null
}

export interface ExpertReviewByTokenResult {
  review: ExpertReview
  project: ExpertReviewProjectInfo
  items: ExpertReviewItem[]
  slides: ExpertReviewSlideInfo[]
}

export interface ExpertReviewItem {
  id: string
  expert_review_id: string
  slide_id: string
  field: string
  status: ExpertReviewItemStatus
  comment: string | null
  created_at: string
  /** RPC/UI: translations 조인 시 채워짐 */
  source?: string
  vi_text?: string
  original_vi_text?: string
  back_translation?: string
}

export interface ChangeLog {
  id: string
  project_id: string
  user_id: string | null
  action: ChangeLogAction
  detail: string | null
  metadata: Record<string, unknown> | null
  changed_at: string
}

// ─── Supabase Database 타입 ─────────────────────────────────────────────────

type GenericRelationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type TableDef<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: GenericRelationship[]
}

export interface Database {
  public: {
    Tables: {
      profiles: TableDef<
        Profile,
        Omit<Profile, 'created_at' | 'updated_at'> & {
          created_at?: string
          updated_at?: string
        },
        Partial<Omit<Profile, 'id'>>
      >
      settings: TableDef<
        SettingRow,
        { key: string; value?: string | null },
        { value?: string | null }
      >
      projects: TableDef<
        Project,
        Omit<Project, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        },
        Partial<Omit<Project, 'id'>>
      >
      slides: TableDef<
        Slide,
        Omit<Slide, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        },
        Partial<Omit<Slide, 'id'>>
      >
      spelling_results: TableDef<
        SpellingResult,
        Omit<SpellingResult, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        },
        Partial<Omit<SpellingResult, 'id'>>
      >
      translations: TableDef<
        Translation,
        Omit<Translation, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        },
        Partial<Omit<Translation, 'id'>>
      >
      verifications: TableDef<
        Verification,
        Omit<Verification, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        },
        Partial<Omit<Verification, 'id'>>
      >
      expert_reviews: TableDef<
        ExpertReview,
        Omit<ExpertReview, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        },
        Partial<Omit<ExpertReview, 'id'>>
      >
      expert_review_items: TableDef<
        ExpertReviewItem,
        Omit<ExpertReviewItem, 'id' | 'created_at' | 'source' | 'vi_text'> & {
          id?: string
          created_at?: string
        },
        Partial<Omit<ExpertReviewItem, 'id' | 'source' | 'vi_text'>>
      >
      change_logs: TableDef<
        ChangeLog,
        Omit<ChangeLog, 'id' | 'changed_at'> & {
          id?: string
          changed_at?: string
        },
        Partial<Omit<ChangeLog, 'id'>>
      >
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_expert_review: {
        Args: {
          p_project_id: string
          p_expert_name: string
          p_expert_email: string
          p_message?: string | null
        }
        Returns: ExpertReview
      }
      get_expert_review_by_token: {
        Args: { p_token: string }
        Returns: ExpertReviewByTokenResult
      }
      save_expert_review_item: {
        Args: {
          p_token: string
          p_item_id: string
          p_status: ExpertReviewItemStatus
          p_vi_text?: string
          p_comment?: string
        }
        Returns: ExpertReviewItem
      }
      complete_expert_review: {
        Args: { p_token: string }
        Returns: { success: boolean }
      }
      admin_delete_project: {
        Args: { p_project_id: string }
        Returns: { success: boolean }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
