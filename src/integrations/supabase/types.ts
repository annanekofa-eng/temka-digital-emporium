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
      admin_callbacks: {
        Row: {
          created_at: string
          expires_at: string
          payload: Json
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          payload?: Json
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          payload?: Json
          token?: string
        }
        Relationships: []
      }
      admin_log: {
        Row: {
          action: string
          admin_telegram_id: number
          created_at: string
          id: string
          meta: Json
          target: string | null
        }
        Insert: {
          action: string
          admin_telegram_id: number
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Update: {
          action?: string
          admin_telegram_id?: number
          created_at?: string
          id?: string
          meta?: Json
          target?: string | null
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          expires_at: string
          payload: Json
          state: string
          telegram_id: number
          updated_at: string
        }
        Insert: {
          expires_at?: string
          payload?: Json
          state: string
          telegram_id: number
          updated_at?: string
        }
        Update: {
          expires_at?: string
          payload?: Json
          state?: string
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      balance_history: {
        Row: {
          admin_telegram_id: number
          amount: number
          balance_after: number
          comment: string
          created_at: string
          id: string
          telegram_id: number
          type: string
        }
        Insert: {
          admin_telegram_id: number
          amount: number
          balance_after?: number
          comment?: string
          created_at?: string
          id?: string
          telegram_id: number
          type?: string
        }
        Update: {
          admin_telegram_id?: number
          amount?: number
          balance_after?: number
          comment?: string
          created_at?: string
          id?: string
          telegram_id?: number
          type?: string
        }
        Relationships: []
      }
      broadcasts: {
        Row: {
          admin_telegram_id: number
          audience: string
          created_at: string
          cursor_telegram_id: number | null
          error_message: string | null
          failed_count: number
          id: string
          photo_url: string | null
          sent_count: number
          status: string
          text: string
          total_count: number
          updated_at: string
        }
        Insert: {
          admin_telegram_id: number
          audience?: string
          created_at?: string
          cursor_telegram_id?: number | null
          error_message?: string | null
          failed_count?: number
          id?: string
          photo_url?: string | null
          sent_count?: number
          status?: string
          text?: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          admin_telegram_id?: number
          audience?: string
          created_at?: string
          cursor_telegram_id?: number | null
          error_message?: string | null
          failed_count?: number
          id?: string
          photo_url?: string | null
          sent_count?: number
          status?: string
          text?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          created_at: string
          id: string
          params: Json
          product_id: string
          product_title: string
          product_type: string
          qty: number
          telegram_id: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          params?: Json
          product_id: string
          product_title: string
          product_type?: string
          qty?: number
          telegram_id: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          params?: Json
          product_id?: string
          product_title?: string
          product_type?: string
          qty?: number
          telegram_id?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          project_id: string | null
          slug: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          icon?: string
          id: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          project_id?: string | null
          slug?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          project_id?: string | null
          slug?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          content: string
          created_at: string
          id: string
          order_id: string | null
          product_id: string
          sold_at: string | null
          status: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          order_id?: string | null
          product_id: string
          sold_at?: string | null
          status?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          order_id?: string | null
          product_id?: string
          sold_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          is_active: boolean
          key: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          is_active?: boolean
          key: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          is_active?: boolean
          key?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          external_payload: Json
          id: string
          order_id: string
          params: Json
          product_id: string
          product_price: number
          product_title: string
          quantity: number
          recipient_username: string | null
        }
        Insert: {
          created_at?: string
          external_payload?: Json
          id?: string
          order_id: string
          params?: Json
          product_id: string
          product_price: number
          product_title: string
          quantity?: number
          recipient_username?: string | null
        }
        Update: {
          created_at?: string
          external_payload?: Json
          id?: string
          order_id?: string
          params?: Json
          product_id?: string
          product_price?: number
          product_title?: string
          quantity?: number
          recipient_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          auto_delivered_at: string | null
          auto_delivered_by: number | null
          auto_error_note: string | null
          auto_status: string | null
          balance_charged_at: string | null
          balance_used: number
          created_at: string
          currency: string
          discount_amount: number
          external_ref: string | null
          fulfilled_at: string | null
          id: string
          invoice_id: string | null
          is_auto: boolean
          notes: string | null
          order_number: string
          pay_url: string | null
          payment_status: string
          project_id: string | null
          promo_code: string | null
          status: string
          telegram_id: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          auto_delivered_at?: string | null
          auto_delivered_by?: number | null
          auto_error_note?: string | null
          auto_status?: string | null
          balance_charged_at?: string | null
          balance_used?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          external_ref?: string | null
          fulfilled_at?: string | null
          id?: string
          invoice_id?: string | null
          is_auto?: boolean
          notes?: string | null
          order_number: string
          pay_url?: string | null
          payment_status?: string
          project_id?: string | null
          promo_code?: string | null
          status?: string
          telegram_id: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          auto_delivered_at?: string | null
          auto_delivered_by?: number | null
          auto_error_note?: string | null
          auto_status?: string | null
          balance_charged_at?: string | null
          balance_used?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          external_ref?: string | null
          fulfilled_at?: string | null
          id?: string
          invoice_id?: string | null
          is_auto?: boolean
          notes?: string | null
          order_number?: string
          pay_url?: string | null
          payment_status?: string
          project_id?: string | null
          promo_code?: string | null
          status?: string
          telegram_id?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_notifications: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          order_id: string
          payload: Json
          sent_at: string | null
          telegram_id: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id: string
          payload?: Json
          sent_at?: string | null
          telegram_id: number
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id?: string
          payload?: Json
          sent_at?: string | null
          telegram_id?: number
        }
        Relationships: []
      }
      processed_invoices: {
        Row: {
          amount: number | null
          invoice_id: string
          order_id: string | null
          processed_at: string
          telegram_id: number | null
          type: string
        }
        Insert: {
          amount?: number | null
          invoice_id: string
          order_id?: string | null
          processed_at?: string
          telegram_id?: number | null
          type?: string
        }
        Update: {
          amount?: number | null
          invoice_id?: string
          order_id?: string | null
          processed_at?: string
          telegram_id?: number | null
          type?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category_id: string | null
          created_at: string
          delivery_type: string
          description: string
          external_link: string | null
          features: string[]
          gallery: Json
          guarantee: string
          id: string
          image: string | null
          is_active: boolean
          is_featured: boolean
          is_new: boolean
          is_popular: boolean
          max_qty: number
          min_qty: number
          old_price: number | null
          platform: string
          price: number
          product_type: string
          project_id: string | null
          region: string
          slug: string | null
          sort_order: number
          specifications: Json
          stock: number
          subcategory: string
          subtitle: string
          tags: string[]
          term_options: Json
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          delivery_type?: string
          description?: string
          external_link?: string | null
          features?: string[]
          gallery?: Json
          guarantee?: string
          id?: string
          image?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_new?: boolean
          is_popular?: boolean
          max_qty?: number
          min_qty?: number
          old_price?: number | null
          platform?: string
          price: number
          product_type?: string
          project_id?: string | null
          region?: string
          slug?: string | null
          sort_order?: number
          specifications?: Json
          stock?: number
          subcategory?: string
          subtitle?: string
          tags?: string[]
          term_options?: Json
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          delivery_type?: string
          description?: string
          external_link?: string | null
          features?: string[]
          gallery?: Json
          guarantee?: string
          id?: string
          image?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_new?: boolean
          is_popular?: boolean
          max_qty?: number
          min_qty?: number
          old_price?: number | null
          platform?: string
          price?: number
          product_type?: string
          project_id?: string | null
          region?: string
          slug?: string | null
          sort_order?: number
          specifications?: Json
          stock?: number
          subcategory?: string
          subtitle?: string
          tags?: string[]
          term_options?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          banner: string | null
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          sort_order: number
          subtitle: string
          title: string
          updated_at: string
        }
        Insert: {
          banner?: string | null
          created_at?: string
          description?: string
          icon?: string
          id: string
          is_active?: boolean
          sort_order?: number
          subtitle?: string
          title: string
          updated_at?: string
        }
        Update: {
          banner?: string | null
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          subtitle?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      promocodes: {
        Row: {
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          max_uses: number | null
          max_uses_per_user: number | null
          owner_telegram_id: number | null
          used_count: number
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string
          discount_type?: string
          discount_value: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          owner_telegram_id?: number | null
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          max_uses_per_user?: number | null
          owner_telegram_id?: number | null
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          created_at: string
          id: string
          identifier: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          identifier: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          identifier?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          author: string
          avatar: string
          created_at: string
          id: string
          moderation_status: string
          product_id: string | null
          rating: number
          telegram_id: number | null
          text: string
          verified: boolean
        }
        Insert: {
          author: string
          avatar?: string
          created_at?: string
          id?: string
          moderation_status?: string
          product_id?: string | null
          rating: number
          telegram_id?: number | null
          text?: string
          verified?: boolean
        }
        Update: {
          author?: string
          avatar?: string
          created_at?: string
          id?: string
          moderation_status?: string
          product_id?: string | null
          rating?: number
          telegram_id?: number | null
          text?: string
          verified?: boolean
        }
        Relationships: []
      }
      sbp_payments: {
        Row: {
          amount_rub: number
          amount_usd: number
          created_at: string
          id: string
          order_id: string
          rate: number
          receipt_url: string | null
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: number | null
          status: string
          telegram_id: number
          updated_at: string
        }
        Insert: {
          amount_rub: number
          amount_usd: number
          created_at?: string
          id?: string
          order_id: string
          rate?: number
          receipt_url?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: number | null
          status?: string
          telegram_id: number
          updated_at?: string
        }
        Update: {
          amount_rub?: number
          amount_usd?: number
          created_at?: string
          id?: string
          order_id?: string
          rate?: number
          receipt_url?: string | null
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: number | null
          status?: string
          telegram_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      sbp_requisites: {
        Row: {
          bank: string
          card: string
          holder_name: string
          key: string
          phone: string
          updated_at: string
        }
        Insert: {
          bank?: string
          card?: string
          holder_name?: string
          key: string
          phone?: string
          updated_at?: string
        }
        Update: {
          bank?: string
          card?: string
          holder_name?: string
          key?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          accepted_terms: boolean
          balance: number
          created_at: string
          first_name: string
          id: string
          internal_note: string | null
          is_blocked: boolean
          is_premium: boolean
          language_code: string | null
          last_name: string | null
          photo_url: string | null
          role: string
          telegram_id: number
          updated_at: string
          username: string | null
        }
        Insert: {
          accepted_terms?: boolean
          balance?: number
          created_at?: string
          first_name?: string
          id?: string
          internal_note?: string | null
          is_blocked?: boolean
          is_premium?: boolean
          language_code?: string | null
          last_name?: string | null
          photo_url?: string | null
          role?: string
          telegram_id: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          accepted_terms?: boolean
          balance?: number
          created_at?: string
          first_name?: string
          id?: string
          internal_note?: string | null
          is_blocked?: boolean
          is_premium?: boolean
          language_code?: string | null
          last_name?: string | null
          photo_url?: string | null
          role?: string
          telegram_id?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      wheel_spins: {
        Row: {
          created_at: string
          id: string
          prize_value: number
          promo_code: string | null
          telegram_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          prize_value: number
          promo_code?: string | null
          telegram_id: number
        }
        Update: {
          created_at?: string
          id?: string
          prize_value?: number
          promo_code?: string | null
          telegram_id?: number
        }
        Relationships: []
      }
    }
    Views: {
      public_reviews: {
        Row: {
          author: string | null
          avatar: string | null
          created_at: string | null
          id: string | null
          moderation_status: string | null
          product_id: string | null
          rating: number | null
          text: string | null
          verified: boolean | null
        }
        Insert: {
          author?: string | null
          avatar?: string | null
          created_at?: string | null
          id?: string | null
          moderation_status?: string | null
          product_id?: string | null
          rating?: number | null
          text?: string | null
          verified?: boolean | null
        }
        Update: {
          author?: string | null
          avatar?: string | null
          created_at?: string | null
          id?: string | null
          moderation_status?: string | null
          product_id?: string | null
          rating?: number | null
          text?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      attach_wheel_promo: {
        Args: { p_code: string; p_spin_id: string; p_telegram_id: number }
        Returns: undefined
      }
      cleanup_admin_expired: { Args: never; Returns: undefined }
      credit_balance: {
        Args: { p_amount: number; p_telegram_id: number }
        Returns: number
      }
      deduct_balance: {
        Args: { p_amount: number; p_telegram_id: number }
        Returns: number
      }
      get_wheel_status: { Args: { p_telegram_id: number }; Returns: Json }
      increment_promo_usage: { Args: { p_code: string }; Returns: undefined }
      release_promo: { Args: { p_code: string }; Returns: undefined }
      reserve_inventory: {
        Args: { p_order_id: string; p_product_id: string; p_quantity: number }
        Returns: {
          content: string
          id: string
        }[]
      }
      sync_product_stock: { Args: { p_product_id: string }; Returns: undefined }
      try_claim_promo: {
        Args: { p_code: string; p_telegram_id: number }
        Returns: Json
      }
      try_claim_wheel_spin: {
        Args: { p_prize: number; p_telegram_id: number }
        Returns: Json
      }
      try_fulfill_pending_orders: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      validate_promo_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
