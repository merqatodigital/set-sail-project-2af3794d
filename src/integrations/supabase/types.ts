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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      agent_actions_log: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          session_id: string | null
          success: boolean | null
          tool_input: Json | null
          tool_name: string | null
          tool_output: Json | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          session_id?: string | null
          success?: boolean | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output?: Json | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          session_id?: string | null
          success?: boolean | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output?: Json | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          amount: number
          check_in: string
          check_out: string
          created_at: string
          guest_id: string
          guest_name: string
          guest_phone: string
          guests: number
          id: string
          notes: string
          paid_amount: number
          reference: string
          room_type: string
          source: string
          status: string
        }
        Insert: {
          amount?: number
          check_in?: string
          check_out?: string
          created_at?: string
          guest_id?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id: string
          notes?: string
          paid_amount?: number
          reference?: string
          room_type?: string
          source?: string
          status?: string
        }
        Update: {
          amount?: number
          check_in?: string
          check_out?: string
          created_at?: string
          guest_id?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          reference?: string
          room_type?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      chat_logs: {
        Row: {
          cache_hit: boolean | null
          content: string
          created_at: string | null
          guest_id: string | null
          id: string
          response_time_ms: number | null
          role: string
          session_id: string
          tool_called: string | null
          tool_result: Json | null
        }
        Insert: {
          cache_hit?: boolean | null
          content: string
          created_at?: string | null
          guest_id?: string | null
          id?: string
          response_time_ms?: number | null
          role: string
          session_id: string
          tool_called?: string | null
          tool_result?: Json | null
        }
        Update: {
          cache_hit?: boolean | null
          content?: string
          created_at?: string | null
          guest_id?: string | null
          id?: string
          response_time_ms?: number | null
          role?: string
          session_id?: string
          tool_called?: string | null
          tool_result?: Json | null
        }
        Relationships: []
      }
      cms_data: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      guest_preferences: {
        Row: {
          created_at: string | null
          guest_id: string
          id: string
          preference_type: string
          preference_value: string
        }
        Insert: {
          created_at?: string | null
          guest_id: string
          id?: string
          preference_type: string
          preference_value: string
        }
        Update: {
          created_at?: string | null
          guest_id?: string
          id?: string
          preference_type?: string
          preference_value?: string
        }
        Relationships: []
      }
      guests: {
        Row: {
          country: string
          created_at: string
          email: string
          id: string
          name: string
          notes: string
          phone: string
        }
        Insert: {
          country?: string
          created_at?: string
          email?: string
          id: string
          name?: string
          notes?: string
          phone?: string
        }
        Update: {
          country?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
        }
        Relationships: []
      }
      hermes_runs: {
        Row: {
          agent: string
          created_at: string
          created_by: string | null
          id: string
          model: string
          request: string
          resort_id: string
          result: string
          status: string
          task_id: string | null
        }
        Insert: {
          agent: string
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          request?: string
          resort_id?: string
          result?: string
          status?: string
          task_id?: string | null
        }
        Update: {
          agent?: string
          created_at?: string
          created_by?: string | null
          id?: string
          model?: string
          request?: string
          resort_id?: string
          result?: string
          status?: string
          task_id?: string | null
        }
        Relationships: []
      }
      hermes_settings: {
        Row: {
          created_at: string
          github_repository: string
          last_verification: Json
          last_verified_at: string | null
          ollama_base_url: string | null
          ollama_model: string | null
          openrouter_model: string | null
          provider: string
          resend_from_email: string | null
          resort_cms_key: string
          resort_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          github_repository?: string
          last_verification?: Json
          last_verified_at?: string | null
          ollama_base_url?: string | null
          ollama_model?: string | null
          openrouter_model?: string | null
          provider?: string
          resend_from_email?: string | null
          resort_cms_key?: string
          resort_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          github_repository?: string
          last_verification?: Json
          last_verified_at?: string | null
          ollama_base_url?: string | null
          ollama_model?: string | null
          openrouter_model?: string | null
          provider?: string
          resend_from_email?: string | null
          resort_cms_key?: string
          resort_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          category: string
          id: string
          name: string
          notes: string
          quantity: number
          reorder_threshold: number
          unit: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          category?: string
          id: string
          name?: string
          notes?: string
          quantity?: number
          reorder_threshold?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          category?: string
          id?: string
          name?: string
          notes?: string
          quantity?: number
          reorder_threshold?: number
          unit?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      motorbike_rentals: {
        Row: {
          amount: number
          bike_id: string
          bike_name: string
          created_at: string
          days: number
          deposit: number
          end_date: string
          guest_name: string
          guest_phone: string
          id: string
          notes: string
          paid_amount: number
          reference: string
          start_date: string
          status: string
        }
        Insert: {
          amount?: number
          bike_id?: string
          bike_name?: string
          created_at?: string
          days?: number
          deposit?: number
          end_date?: string
          guest_name?: string
          guest_phone?: string
          id: string
          notes?: string
          paid_amount?: number
          reference?: string
          start_date?: string
          status?: string
        }
        Update: {
          amount?: number
          bike_id?: string
          bike_name?: string
          created_at?: string
          days?: number
          deposit?: number
          end_date?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          notes?: string
          paid_amount?: number
          reference?: string
          start_date?: string
          status?: string
        }
        Relationships: []
      }
      motorbikes: {
        Row: {
          active: boolean
          daily_rate: number
          id: string
          model: string
          name: string
          notes: string
          plate: string
          status: string
        }
        Insert: {
          active?: boolean
          daily_rate?: number
          id: string
          model?: string
          name?: string
          notes?: string
          plate?: string
          status?: string
        }
        Update: {
          active?: boolean
          daily_rate?: number
          id?: string
          model?: string
          name?: string
          notes?: string
          plate?: string
          status?: string
        }
        Relationships: []
      }
      pay_records: {
        Row: {
          amount: number
          hours: number
          id: string
          method: string
          notes: string
          paid: boolean
          paid_at: string
          period_end: string
          period_start: string
          staff_id: string
        }
        Insert: {
          amount?: number
          hours?: number
          id: string
          method?: string
          notes?: string
          paid?: boolean
          paid_at?: string
          period_end?: string
          period_start?: string
          staff_id?: string
        }
        Update: {
          amount?: number
          hours?: number
          id?: string
          method?: string
          notes?: string
          paid?: boolean
          paid_at?: string
          period_end?: string
          period_start?: string
          staff_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          category: string
          date: string
          description: string
          direction: string
          id: string
          method: string
          notes: string
          reference: string
          related_id: string
        }
        Insert: {
          amount?: number
          category?: string
          date?: string
          description?: string
          direction?: string
          id: string
          method?: string
          notes?: string
          reference?: string
          related_id?: string
        }
        Update: {
          amount?: number
          category?: string
          date?: string
          description?: string
          direction?: string
          id?: string
          method?: string
          notes?: string
          reference?: string
          related_id?: string
        }
        Relationships: []
      }
      resort_members: {
        Row: {
          created_at: string
          resort_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          resort_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          resort_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      room_availability: {
        Row: {
          booking_id: string | null
          date: string
          id: string
          notes: string | null
          room_id: string | null
          status: string | null
        }
        Insert: {
          booking_id?: string | null
          date: string
          id?: string
          notes?: string | null
          room_id?: string | null
          status?: string | null
        }
        Update: {
          booking_id?: string | null
          date?: string
          id?: string
          notes?: string | null
          room_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_availability_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          amenities: Json | null
          capacity: number
          created_at: string | null
          id: string
          images: Json | null
          name: string
          rate_php: number
          rate_usd: number | null
          slug: string
          status: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          amenities?: Json | null
          capacity?: number
          created_at?: string | null
          id?: string
          images?: Json | null
          name: string
          rate_php: number
          rate_usd?: number | null
          slug: string
          status?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          amenities?: Json | null
          capacity?: number
          created_at?: string | null
          id?: string
          images?: Json | null
          name?: string
          rate_php?: number
          rate_usd?: number | null
          slug?: string
          status?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          date: string
          end_time: string
          hours_worked: number
          id: string
          notes: string
          staff_id: string
          start_time: string
        }
        Insert: {
          date?: string
          end_time?: string
          hours_worked?: number
          id: string
          notes?: string
          staff_id?: string
          start_time?: string
        }
        Update: {
          date?: string
          end_time?: string
          hours_worked?: number
          id?: string
          notes?: string
          staff_id?: string
          start_time?: string
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          active: boolean
          email: string
          hired_at: string
          id: string
          name: string
          notes: string
          pay_rate: number
          pay_type: string
          phone: string
          role: string
        }
        Insert: {
          active?: boolean
          email?: string
          hired_at?: string
          id: string
          name?: string
          notes?: string
          pay_rate?: number
          pay_type?: string
          phone?: string
          role?: string
        }
        Update: {
          active?: boolean
          email?: string
          hired_at?: string
          id?: string
          name?: string
          notes?: string
          pay_rate?: number
          pay_type?: string
          phone?: string
          role?: string
        }
        Relationships: []
      }
      staff_tasks: {
        Row: {
          assigned_to: string | null
          booking_id: string | null
          category: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          priority: string | null
          room_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          assigned_to?: string | null
          booking_id?: string | null
          category: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string | null
          room_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          assigned_to?: string | null
          booking_id?: string | null
          category?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string | null
          room_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: []
      }
      tala_audit_log: {
        Row: {
          created_at: string
          department: string
          guest_message: string
          id: string
          intent: string
          reply_preview: string
          sentiment: string | null
          tools_used: string[]
          urgency: string
        }
        Insert: {
          created_at?: string
          department?: string
          guest_message?: string
          id?: string
          intent?: string
          reply_preview?: string
          sentiment?: string | null
          tools_used?: string[]
          urgency?: string
        }
        Update: {
          created_at?: string
          department?: string
          guest_message?: string
          id?: string
          intent?: string
          reply_preview?: string
          sentiment?: string | null
          tools_used?: string[]
          urgency?: string
        }
        Relationships: []
      }
      tala_booking_requests: {
        Row: {
          amount: number
          check_in: string
          check_out: string
          confirmed_at: string | null
          created_at: string
          guest_email: string
          guest_name: string
          guest_phone: string
          guests: number
          id: string
          notes: string
          paid_amount: number
          paid_at: string | null
          reference: string
          room_type: string
          source: string
          status: string
        }
        Insert: {
          amount?: number
          check_in?: string
          check_out?: string
          confirmed_at?: string | null
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          room_type?: string
          source?: string
          status?: string
        }
        Update: {
          amount?: number
          check_in?: string
          check_out?: string
          confirmed_at?: string | null
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          room_type?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      tala_briefings: {
        Row: {
          brief_date: string
          generated_at: string
          highlights: Json
          id: string
          summary: string
          whatsapp_sent: boolean
        }
        Insert: {
          brief_date?: string
          generated_at?: string
          highlights?: Json
          id?: string
          summary?: string
          whatsapp_sent?: boolean
        }
        Update: {
          brief_date?: string
          generated_at?: string
          highlights?: Json
          id?: string
          summary?: string
          whatsapp_sent?: boolean
        }
        Relationships: []
      }
      tala_folio_lines: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          guest_name: string
          guest_phone: string
          id: string
          kind: string
          method: string
          reference: string
          related_id: string
          related_type: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          kind?: string
          method?: string
          reference?: string
          related_id?: string
          related_type?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          kind?: string
          method?: string
          reference?: string
          related_id?: string
          related_type?: string
        }
        Relationships: []
      }
      tala_food_orders: {
        Row: {
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          delivered_at: string | null
          guest_name: string
          guest_phone: string
          id: string
          items: Json
          notes: string
          paid_amount: number
          paid_at: string | null
          preparing_at: string | null
          ready_at: string | null
          reference: string
          source: string
          status: string
          total: number
          total_cost: number
        }
        Insert: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          guest_name?: string
          guest_phone?: string
          id?: string
          items?: Json
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          reference?: string
          source?: string
          status?: string
          total?: number
          total_cost?: number
        }
        Update: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          guest_name?: string
          guest_phone?: string
          id?: string
          items?: Json
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          preparing_at?: string | null
          ready_at?: string | null
          reference?: string
          source?: string
          status?: string
          total?: number
          total_cost?: number
        }
        Relationships: []
      }
      tala_goals: {
        Row: {
          created_at: string
          description: string
          id: string
          status: string
          target_date: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          status?: string
          target_date?: string
          title?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          status?: string
          target_date?: string
          title?: string
        }
        Relationships: []
      }
      tala_guest_memory: {
        Row: {
          fact: string
          guest_key: string
          updated_at: string
        }
        Insert: {
          fact?: string
          guest_key?: string
          updated_at?: string
        }
        Update: {
          fact?: string
          guest_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      tala_guest_messages: {
        Row: {
          created_at: string
          guest_name: string
          guest_phone: string
          id: string
          message: string
          replied_at: string | null
          reply: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          message?: string
          replied_at?: string | null
          reply?: string
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          message?: string
          replied_at?: string | null
          reply?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      tala_knowledge: {
        Row: {
          body: string
          created_at: string
          enabled: boolean
          id: string
          label: string
          resort_id: string
          sort_order: number
          tags: string
          topic: string
        }
        Insert: {
          body?: string
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          resort_id?: string
          sort_order?: number
          tags?: string
          topic?: string
        }
        Update: {
          body?: string
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          resort_id?: string
          sort_order?: number
          tags?: string
          topic?: string
        }
        Relationships: []
      }
      tala_leads: {
        Row: {
          contact: string
          created_at: string
          id: string
          name: string
          note: string
          source: string
          source_url: string
        }
        Insert: {
          contact?: string
          created_at?: string
          id?: string
          name?: string
          note?: string
          source?: string
          source_url?: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          name?: string
          note?: string
          source?: string
          source_url?: string
        }
        Relationships: []
      }
      tala_proactive_messages: {
        Row: {
          created_at: string
          guest_name: string
          guest_phone: string
          id: string
          message: string
          read: boolean
          sent: boolean
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          guest_name: string
          guest_phone: string
          id: string
          message: string
          read?: boolean
          sent?: boolean
          title: string
          type: string
        }
        Update: {
          created_at?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          message?: string
          read?: boolean
          sent?: boolean
          title?: string
          type?: string
        }
        Relationships: []
      }
      tala_rental_requests: {
        Row: {
          amount: number
          bike_name: string
          confirmed_at: string | null
          created_at: string
          days: number
          end_date: string
          guest_email: string
          guest_name: string
          guest_phone: string
          id: string
          notes: string
          paid_amount: number
          paid_at: string | null
          reference: string
          source: string
          start_date: string
          status: string
        }
        Insert: {
          amount?: number
          bike_name?: string
          confirmed_at?: string | null
          created_at?: string
          days?: number
          end_date?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          source?: string
          start_date?: string
          status?: string
        }
        Update: {
          amount?: number
          bike_name?: string
          confirmed_at?: string | null
          created_at?: string
          days?: number
          end_date?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          source?: string
          start_date?: string
          status?: string
        }
        Relationships: []
      }
      tala_tasks: {
        Row: {
          category: string
          created_at: string
          due: string
          id: string
          status: string
          title: string
        }
        Insert: {
          category?: string
          created_at?: string
          due?: string
          id?: string
          status?: string
          title?: string
        }
        Update: {
          category?: string
          created_at?: string
          due?: string
          id?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      tala_tour_requests: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string
          guest_email: string
          guest_name: string
          guest_phone: string
          guests: number
          id: string
          notes: string
          paid_amount: number
          paid_at: string | null
          reference: string
          source: string
          status: string
          tour_date: string
          tour_name: string
        }
        Insert: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          source?: string
          status?: string
          tour_date?: string
          tour_name?: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          paid_at?: string | null
          reference?: string
          source?: string
          status?: string
          tour_date?: string
          tour_name?: string
        }
        Relationships: []
      }
      tala_wins: {
        Row: {
          brief_date: string
          created_at: string
          id: string
          text: string
        }
        Insert: {
          brief_date?: string
          created_at?: string
          id?: string
          text?: string
        }
        Update: {
          brief_date?: string
          created_at?: string
          id?: string
          text?: string
        }
        Relationships: []
      }
      tour_bookings: {
        Row: {
          amount: number
          created_at: string
          date: string
          guest_name: string
          guest_phone: string
          guests: number
          id: string
          notes: string
          paid_amount: number
          reference: string
          status: string
          tour_id: string
          tour_name: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id: string
          notes?: string
          paid_amount?: number
          reference?: string
          status?: string
          tour_id?: string
          tour_name?: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          guest_name?: string
          guest_phone?: string
          guests?: number
          id?: string
          notes?: string
          paid_amount?: number
          reference?: string
          status?: string
          tour_id?: string
          tour_name?: string
        }
        Relationships: []
      }
      tours_catalog: {
        Row: {
          active: boolean
          capacity: number
          description: string
          duration: string
          id: string
          inclusions: string[]
          name: string
          price: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          capacity?: number
          description?: string
          duration?: string
          id: string
          inclusions?: string[]
          name?: string
          price?: number
          sort_order?: number
        }
        Update: {
          active?: boolean
          capacity?: number
          description?: string
          duration?: string
          id?: string
          inclusions?: string[]
          name?: string
          price?: number
          sort_order?: number
        }
        Relationships: []
      }
      transport_bookings: {
        Row: {
          booking_id: string | null
          created_at: string | null
          dropoff_location: string | null
          guest_id: string | null
          id: string
          pickup_location: string | null
          scheduled_time: string | null
          status: string | null
          transport_type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          dropoff_location?: string | null
          guest_id?: string | null
          id?: string
          pickup_location?: string | null
          scheduled_time?: string | null
          status?: string | null
          transport_type: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          dropoff_location?: string | null
          guest_id?: string | null
          id?: string
          pickup_location?: string | null
          scheduled_time?: string | null
          status?: string | null
          transport_type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_tala_briefing: {
        Args: never
        Returns: {
          brief_date: string
          generated_at: string
          highlights: Json
          id: string
          summary: string
          whatsapp_sent: boolean
        }
        SetofOptions: {
          from: "*"
          to: "tala_briefings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      purge_old_audit_log: { Args: never; Returns: undefined }
      purge_old_briefings: { Args: never; Returns: undefined }
      purge_old_proactive_messages: { Args: never; Returns: undefined }
      room_availability_conflicts: {
        Args: { p_check_in: string; p_check_out: string }
        Returns: {
          check_in: string
          check_out: string
          room_type: string
        }[]
      }
      tala_health: {
        Args: never
        Returns: {
          status: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      app_role: "admin"
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
      app_role: ["admin"],
    },
  },
} as const
