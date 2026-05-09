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
      categories: {
        Row: {
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          name: string
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
          slug?: string | null
          sort_order?: number
        }
        Relationships: []
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
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          product_price: number
          product_title: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          product_price: number
          product_title: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          product_price?: number
          product_title?: string
          quantity?: number
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
          balance_used: number
          created_at: string
          currency: string
          discount_amount: number
          id: string
          invoice_id: string | null
          notes: string | null
          order_number: string
          pay_url: string | null
          payment_status: string
          promo_code: string | null
          status: string
          telegram_id: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          balance_used?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          order_number: string
          pay_url?: string | null
          payment_status?: string
          promo_code?: string | null
          status?: string
          telegram_id: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          balance_used?: number
          created_at?: string
          currency?: string
          discount_amount?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          order_number?: string
          pay_url?: string | null
          payment_status?: string
          promo_code?: string | null
          status?: string
          telegram_id?: number
          total_amount?: number
          updated_at?: string
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
          features: string[]
          guarantee: string
          id: string
          image: string | null
          is_active: boolean
          is_featured: boolean
          is_new: boolean
          is_popular: boolean
          old_price: number | null
          platform: string
          price: number
          region: string
          slug: string | null
          sort_order: number
          specifications: Json
          stock: number
          subcategory: string
          subtitle: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          delivery_type?: string
          description?: string
          features?: string[]
          guarantee?: string
          id?: string
          image?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_new?: boolean
          is_popular?: boolean
          old_price?: number | null
          platform?: string
          price: number
          region?: string
          slug?: string | null
          sort_order?: number
          specifications?: Json
          stock?: number
          subcategory?: string
          subtitle?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          delivery_type?: string
          description?: string
          features?: string[]
          guarantee?: string
          id?: string
          image?: string | null
          is_active?: boolean
          is_featured?: boolean
          is_new?: boolean
          is_popular?: boolean
          old_price?: number | null
          platform?: string
          price?: number
          region?: string
          slug?: string | null
          sort_order?: number
          specifications?: Json
          stock?: number
          subcategory?: string
          subtitle?: string
          tags?: string[]
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
        ]
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
          product_id: string
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
          product_id: string
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
          product_id?: string
          rating?: number
          telegram_id?: number | null
          text?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_reviews: {
        Row: {
          author: string
          avatar: string
          created_at: string
          id: string
          moderation_status: string
          product_id: string | null
          rating: number
          shop_id: string
          telegram_id: number
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
          shop_id: string
          telegram_id: number
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
          shop_id?: string
          telegram_id?: number
          text?: string
          verified?: boolean
        }
        Relationships: []
      }
      tariff_prices: {
        Row: {
          is_enabled: boolean
          plan: string
          price_usd: number
          updated_at: string
        }
        Insert: {
          is_enabled?: boolean
          plan: string
          price_usd?: number
          updated_at?: string
        }
        Update: {
          is_enabled?: boolean
          plan?: string
          price_usd?: number
          updated_at?: string
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
        Relationships: [
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      public_shop_reviews: {
        Row: {
          author: string | null
          avatar: string | null
          created_at: string | null
          id: string | null
          moderation_status: string | null
          product_id: string | null
          rating: number | null
          shop_id: string | null
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
          shop_id?: string | null
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
          shop_id?: string | null
          text?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      credit_balance: {
        Args: { p_amount: number; p_telegram_id: number }
        Returns: number
      }
      deduct_balance: {
        Args: { p_amount: number; p_telegram_id: number }
        Returns: number
      }
      increment_promo_usage: { Args: { p_code: string }; Returns: undefined }
      reserve_inventory: {
        Args: { p_order_id: string; p_product_id: string; p_quantity: number }
        Returns: {
          content: string
          id: string
        }[]
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
