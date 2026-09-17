// Generated from the live Postgres catalog; do not edit table definitions by hand.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = { public: { Tables: {
"app_config": {
Row: {
"id": number;
"vapid_public_key": string | null;
"vapid_private_key": string | null;
"created_at": string | null;
"updated_at": string | null;
};
Insert: {
"id"?: number;
"vapid_public_key"?: string | null;
"vapid_private_key"?: string | null;
"created_at"?: string | null;
"updated_at"?: string | null;
};
Update: {
"id"?: number;
"vapid_public_key"?: string | null;
"vapid_private_key"?: string | null;
"created_at"?: string | null;
"updated_at"?: string | null;
};
Relationships: []; };
"audit_log": {
Row: {
"id": string;
"company_id": string | null;
"actor_id": string | null;
"entity_type": string;
"entity_id": string;
"action": string;
"old_value": Json | null;
"new_value": Json | null;
"created_at": string;
};
Insert: {
"id"?: string;
"company_id"?: string | null;
"actor_id"?: string | null;
"entity_type": string;
"entity_id": string;
"action": string;
"old_value"?: Json | null;
"new_value"?: Json | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"company_id"?: string | null;
"actor_id"?: string | null;
"entity_type"?: string;
"entity_id"?: string;
"action"?: string;
"old_value"?: Json | null;
"new_value"?: Json | null;
"created_at"?: string;
};
Relationships: []; };
"companies": {
Row: {
"id": string;
"name": string;
"slug": string;
"logo_url": string | null;
"brand_color_primary": string | null;
"brand_color_secondary": string | null;
"phone": string | null;
"email": string | null;
"address": string | null;
"currency": string;
"base_fare": number;
"price_per_km": number;
"price_per_minute": number;
"min_fare": number;
"dispatch_radius_km": number;
"is_active": boolean;
"created_at": string;
"updated_at": string;
};
Insert: {
"id"?: string;
"name": string;
"slug": string;
"logo_url"?: string | null;
"brand_color_primary"?: string | null;
"brand_color_secondary"?: string | null;
"phone"?: string | null;
"email"?: string | null;
"address"?: string | null;
"currency"?: string;
"base_fare"?: number;
"price_per_km"?: number;
"price_per_minute"?: number;
"min_fare"?: number;
"dispatch_radius_km"?: number;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Update: {
"id"?: string;
"name"?: string;
"slug"?: string;
"logo_url"?: string | null;
"brand_color_primary"?: string | null;
"brand_color_secondary"?: string | null;
"phone"?: string | null;
"email"?: string | null;
"address"?: string | null;
"currency"?: string;
"base_fare"?: number;
"price_per_km"?: number;
"price_per_minute"?: number;
"min_fare"?: number;
"dispatch_radius_km"?: number;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Relationships: []; };
"coupons": {
Row: {
"id": string;
"company_id": string;
"code": string;
"discount_type": Database["public"]["Enums"]["discount_type"];
"value": number;
"min_order_amount": number | null;
"max_uses": number | null;
"used_count": number;
"valid_from": string | null;
"valid_until": string | null;
"is_active": boolean;
};
Insert: {
"id"?: string;
"company_id": string;
"code": string;
"discount_type"?: Database["public"]["Enums"]["discount_type"];
"value"?: number;
"min_order_amount"?: number | null;
"max_uses"?: number | null;
"used_count"?: number;
"valid_from"?: string | null;
"valid_until"?: string | null;
"is_active"?: boolean;
};
Update: {
"id"?: string;
"company_id"?: string;
"code"?: string;
"discount_type"?: Database["public"]["Enums"]["discount_type"];
"value"?: number;
"min_order_amount"?: number | null;
"max_uses"?: number | null;
"used_count"?: number;
"valid_from"?: string | null;
"valid_until"?: string | null;
"is_active"?: boolean;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "coupons_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}]; };
"driver_documents": {
Row: {
"id": string;
"driver_id": string;
"company_id": string;
"type": Database["public"]["Enums"]["document_type"];
"file_url": string | null;
"status": Database["public"]["Enums"]["document_status"];
"reviewed_at": string | null;
"expires_at": string | null;
"created_at": string;
};
Insert: {
"id"?: string;
"driver_id": string;
"company_id": string;
"type": Database["public"]["Enums"]["document_type"];
"file_url"?: string | null;
"status"?: Database["public"]["Enums"]["document_status"];
"reviewed_at"?: string | null;
"expires_at"?: string | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"driver_id"?: string;
"company_id"?: string;
"type"?: Database["public"]["Enums"]["document_type"];
"file_url"?: string | null;
"status"?: Database["public"]["Enums"]["document_status"];
"reviewed_at"?: string | null;
"expires_at"?: string | null;
"created_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "driver_documents_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["driver_id"], "isOneToOne": false, "foreignKeyName": "driver_documents_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}]; };
"driver_locations": {
Row: {
"driver_id": string;
"company_id": string;
"latitude": number;
"longitude": number;
"heading": number | null;
"speed": number | null;
"accuracy": number | null;
"updated_at": string;
"geo": unknown | null;
"position_at": string | null;
};
Insert: {
"driver_id": string;
"company_id": string;
"latitude": number;
"longitude": number;
"heading"?: number | null;
"speed"?: number | null;
"accuracy"?: number | null;
"updated_at"?: string;
"geo"?: unknown | null;
"position_at"?: string | null;
};
Update: {
"driver_id"?: string;
"company_id"?: string;
"latitude"?: number;
"longitude"?: number;
"heading"?: number | null;
"speed"?: number | null;
"accuracy"?: number | null;
"updated_at"?: string;
"geo"?: unknown | null;
"position_at"?: string | null;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "driver_locations_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["driver_id"], "isOneToOne": true, "foreignKeyName": "driver_locations_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}]; };
"drivers": {
Row: {
"id": string;
"user_id": string;
"company_id": string;
"vehicle_id": string | null;
"is_online": boolean;
"is_verified": boolean;
"rating": number;
"total_trips": number;
"status": Database["public"]["Enums"]["driver_status"];
"created_at": string;
"updated_at": string;
};
Insert: {
"id"?: string;
"user_id": string;
"company_id": string;
"vehicle_id"?: string | null;
"is_online"?: boolean;
"is_verified"?: boolean;
"rating"?: number;
"total_trips"?: number;
"status"?: Database["public"]["Enums"]["driver_status"];
"created_at"?: string;
"updated_at"?: string;
};
Update: {
"id"?: string;
"user_id"?: string;
"company_id"?: string;
"vehicle_id"?: string | null;
"is_online"?: boolean;
"is_verified"?: boolean;
"rating"?: number;
"total_trips"?: number;
"status"?: Database["public"]["Enums"]["driver_status"];
"created_at"?: string;
"updated_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "drivers_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["user_id"], "isOneToOne": true, "foreignKeyName": "drivers_user_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}, {"columns": ["vehicle_id"], "isOneToOne": false, "foreignKeyName": "drivers_vehicle_id_fkey", "referencedColumns": ["id"], "referencedRelation": "vehicles"}]; };
"ledger": {
Row: {
"id": string;
"company_id": string | null;
"transaction_id": string | null;
"account": string;
"entry_type": string;
"amount": number;
"currency": string;
"description": string | null;
"balance_after": number | null;
"created_at": string;
};
Insert: {
"id"?: string;
"company_id"?: string | null;
"transaction_id"?: string | null;
"account": string;
"entry_type": string;
"amount": number;
"currency"?: string;
"description"?: string | null;
"balance_after"?: number | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"company_id"?: string | null;
"transaction_id"?: string | null;
"account"?: string;
"entry_type"?: string;
"amount"?: number;
"currency"?: string;
"description"?: string | null;
"balance_after"?: number | null;
"created_at"?: string;
};
Relationships: []; };
"news_articles": {
Row: {
"id": string;
"title": string;
"slug": string;
"excerpt": string;
"content": string;
"category": string | null;
"featured_image_url": string | null;
"featured_image_alt": string | null;
"author_name": string;
"status": string;
"is_featured": boolean;
"seo_title": string | null;
"seo_description": string | null;
"published_at": string | null;
"created_at": string;
"updated_at": string;
"title_en": string | null;
"excerpt_en": string | null;
"content_en": string | null;
"category_en": string | null;
"seo_title_en": string | null;
"seo_description_en": string | null;
};
Insert: {
"id"?: string;
"title": string;
"slug": string;
"excerpt": string;
"content": string;
"category"?: string | null;
"featured_image_url"?: string | null;
"featured_image_alt"?: string | null;
"author_name"?: string;
"status"?: string;
"is_featured"?: boolean;
"seo_title"?: string | null;
"seo_description"?: string | null;
"published_at"?: string | null;
"created_at"?: string;
"updated_at"?: string;
"title_en"?: string | null;
"excerpt_en"?: string | null;
"content_en"?: string | null;
"category_en"?: string | null;
"seo_title_en"?: string | null;
"seo_description_en"?: string | null;
};
Update: {
"id"?: string;
"title"?: string;
"slug"?: string;
"excerpt"?: string;
"content"?: string;
"category"?: string | null;
"featured_image_url"?: string | null;
"featured_image_alt"?: string | null;
"author_name"?: string;
"status"?: string;
"is_featured"?: boolean;
"seo_title"?: string | null;
"seo_description"?: string | null;
"published_at"?: string | null;
"created_at"?: string;
"updated_at"?: string;
"title_en"?: string | null;
"excerpt_en"?: string | null;
"content_en"?: string | null;
"category_en"?: string | null;
"seo_title_en"?: string | null;
"seo_description_en"?: string | null;
};
Relationships: []; };
"notifications": {
Row: {
"id": string;
"user_id": string;
"company_id": string | null;
"type": string | null;
"title": string | null;
"message": string | null;
"data": Json | null;
"is_read": boolean;
"created_at": string;
};
Insert: {
"id"?: string;
"user_id": string;
"company_id"?: string | null;
"type"?: string | null;
"title"?: string | null;
"message"?: string | null;
"data"?: Json | null;
"is_read"?: boolean;
"created_at"?: string;
};
Update: {
"id"?: string;
"user_id"?: string;
"company_id"?: string | null;
"type"?: string | null;
"title"?: string | null;
"message"?: string | null;
"data"?: Json | null;
"is_read"?: boolean;
"created_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "notifications_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["user_id"], "isOneToOne": false, "foreignKeyName": "notifications_user_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}]; };
"payment_transactions": {
Row: {
"id": string;
"request_id": string;
"company_id": string;
"amount": number;
"method": Database["public"]["Enums"]["payment_method"];
"status": Database["public"]["Enums"]["transaction_status"];
"provider": string | null;
"provider_ref": string | null;
"paid_at": string | null;
"created_at": string;
};
Insert: {
"id"?: string;
"request_id": string;
"company_id": string;
"amount": number;
"method": Database["public"]["Enums"]["payment_method"];
"status"?: Database["public"]["Enums"]["transaction_status"];
"provider"?: string | null;
"provider_ref"?: string | null;
"paid_at"?: string | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"request_id"?: string;
"company_id"?: string;
"amount"?: number;
"method"?: Database["public"]["Enums"]["payment_method"];
"status"?: Database["public"]["Enums"]["transaction_status"];
"provider"?: string | null;
"provider_ref"?: string | null;
"paid_at"?: string | null;
"created_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "payment_transactions_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["request_id"], "isOneToOne": false, "foreignKeyName": "payment_transactions_request_id_fkey", "referencedColumns": ["id"], "referencedRelation": "taxi_requests"}]; };
"profiles": {
Row: {
"id": string;
"first_name": string | null;
"last_name": string | null;
"phone": string | null;
"email": string | null;
"avatar_url": string | null;
"role": Database["public"]["Enums"]["user_role"];
"company_id": string | null;
"is_active": boolean;
"created_at": string;
"updated_at": string;
"language": string;
};
Insert: {
"id": string;
"first_name"?: string | null;
"last_name"?: string | null;
"phone"?: string | null;
"email"?: string | null;
"avatar_url"?: string | null;
"role"?: Database["public"]["Enums"]["user_role"];
"company_id"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
"language"?: string;
};
Update: {
"id"?: string;
"first_name"?: string | null;
"last_name"?: string | null;
"phone"?: string | null;
"email"?: string | null;
"avatar_url"?: string | null;
"role"?: Database["public"]["Enums"]["user_role"];
"company_id"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
"language"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "profiles_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["id"], "isOneToOne": true, "foreignKeyName": "profiles_id_fkey", "referencedColumns": ["id"], "referencedRelation": "users"}]; };
"push_subscriptions": {
Row: {
"id": string;
"user_id": string;
"endpoint": string;
"p256dh": string;
"auth": string;
"user_agent": string | null;
"created_at": string | null;
"updated_at": string | null;
"is_active": boolean;
};
Insert: {
"id"?: string;
"user_id": string;
"endpoint": string;
"p256dh": string;
"auth": string;
"user_agent"?: string | null;
"created_at"?: string | null;
"updated_at"?: string | null;
"is_active"?: boolean;
};
Update: {
"id"?: string;
"user_id"?: string;
"endpoint"?: string;
"p256dh"?: string;
"auth"?: string;
"user_agent"?: string | null;
"created_at"?: string | null;
"updated_at"?: string | null;
"is_active"?: boolean;
};
Relationships: [{"columns": ["user_id"], "isOneToOne": false, "foreignKeyName": "push_subscriptions_user_id_fkey", "referencedColumns": ["id"], "referencedRelation": "users"}]; };
"ratings": {
Row: {
"id": string;
"request_id": string;
"company_id": string;
"customer_id": string;
"driver_id": string;
"score": number;
"feedback": string | null;
"created_at": string;
};
Insert: {
"id"?: string;
"request_id": string;
"company_id": string;
"customer_id": string;
"driver_id": string;
"score": number;
"feedback"?: string | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"request_id"?: string;
"company_id"?: string;
"customer_id"?: string;
"driver_id"?: string;
"score"?: number;
"feedback"?: string | null;
"created_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "ratings_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["customer_id"], "isOneToOne": false, "foreignKeyName": "ratings_customer_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}, {"columns": ["driver_id"], "isOneToOne": false, "foreignKeyName": "ratings_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}, {"columns": ["request_id"], "isOneToOne": true, "foreignKeyName": "ratings_request_id_fkey", "referencedColumns": ["id"], "referencedRelation": "taxi_requests"}]; };
"request_declines": {
Row: {
"id": string;
"request_id": string;
"driver_id": string;
"created_at": string;
};
Insert: {
"id"?: string;
"request_id": string;
"driver_id": string;
"created_at"?: string;
};
Update: {
"id"?: string;
"request_id"?: string;
"driver_id"?: string;
"created_at"?: string;
};
Relationships: [{"columns": ["driver_id"], "isOneToOne": false, "foreignKeyName": "request_declines_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}, {"columns": ["request_id"], "isOneToOne": false, "foreignKeyName": "request_declines_request_id_fkey", "referencedColumns": ["id"], "referencedRelation": "taxi_requests"}]; };
"ride_quotes": {
Row: {
"id": string;
"customer_id": string;
"company_id": string;
"vehicle_type_id": string;
"payload": Json;
"created_at": string;
"expires_at": string;
"request_id": string | null;
};
Insert: {
"id"?: string;
"customer_id": string;
"company_id": string;
"vehicle_type_id": string;
"payload": Json;
"created_at"?: string;
"expires_at"?: string;
"request_id"?: string | null;
};
Update: {
"id"?: string;
"customer_id"?: string;
"company_id"?: string;
"vehicle_type_id"?: string;
"payload"?: Json;
"created_at"?: string;
"expires_at"?: string;
"request_id"?: string | null;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "ride_quotes_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["customer_id"], "isOneToOne": false, "foreignKeyName": "ride_quotes_customer_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}, {"columns": ["request_id"], "isOneToOne": true, "foreignKeyName": "ride_quotes_request_id_fkey", "referencedColumns": ["id"], "referencedRelation": "taxi_requests"}, {"columns": ["vehicle_type_id"], "isOneToOne": false, "foreignKeyName": "ride_quotes_vehicle_type_id_fkey", "referencedColumns": ["id"], "referencedRelation": "vehicle_types"}]; };
"saved_places": {
Row: {
"id": string;
"user_id": string;
"name": string;
"latitude": number;
"longitude": number;
"address": string | null;
"is_home": boolean;
"is_work": boolean;
"created_at": string;
};
Insert: {
"id"?: string;
"user_id": string;
"name": string;
"latitude": number;
"longitude": number;
"address"?: string | null;
"is_home"?: boolean;
"is_work"?: boolean;
"created_at"?: string;
};
Update: {
"id"?: string;
"user_id"?: string;
"name"?: string;
"latitude"?: number;
"longitude"?: number;
"address"?: string | null;
"is_home"?: boolean;
"is_work"?: boolean;
"created_at"?: string;
};
Relationships: [{"columns": ["user_id"], "isOneToOne": false, "foreignKeyName": "saved_places_user_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}]; };
"spatial_ref_sys": {
Row: {
"srid": number;
"auth_name": string | null;
"auth_srid": number | null;
"srtext": string | null;
"proj4text": string | null;
};
Insert: {
"srid": number;
"auth_name"?: string | null;
"auth_srid"?: number | null;
"srtext"?: string | null;
"proj4text"?: string | null;
};
Update: {
"srid"?: number;
"auth_name"?: string | null;
"auth_srid"?: number | null;
"srtext"?: string | null;
"proj4text"?: string | null;
};
Relationships: []; };
"taxi_requests": {
Row: {
"id": string;
"company_id": string;
"customer_id": string;
"driver_id": string | null;
"vehicle_type_id": string | null;
"pickup_latitude": number;
"pickup_longitude": number;
"pickup_address": string | null;
"destination_latitude": number | null;
"destination_longitude": number | null;
"destination_address": string | null;
"status": Database["public"]["Enums"]["request_status"];
"estimated_price": number | null;
"final_price": number | null;
"fare_breakdown": Json | null;
"payment_method": Database["public"]["Enums"]["payment_method"];
"payment_status": Database["public"]["Enums"]["payment_status"];
"requested_at": string | null;
"accepted_at": string | null;
"arrived_at": string | null;
"started_at": string | null;
"completed_at": string | null;
"cancelled_at": string | null;
"cancel_reason": string | null;
"cancelled_by": Database["public"]["Enums"]["cancelled_by"] | null;
"created_at": string;
"updated_at": string;
"estimated_distance_km": number | null;
"estimated_duration_min": number | null;
};
Insert: {
"id"?: string;
"company_id": string;
"customer_id": string;
"driver_id"?: string | null;
"vehicle_type_id"?: string | null;
"pickup_latitude": number;
"pickup_longitude": number;
"pickup_address"?: string | null;
"destination_latitude"?: number | null;
"destination_longitude"?: number | null;
"destination_address"?: string | null;
"status"?: Database["public"]["Enums"]["request_status"];
"estimated_price"?: number | null;
"final_price"?: number | null;
"fare_breakdown"?: Json | null;
"payment_method"?: Database["public"]["Enums"]["payment_method"];
"payment_status"?: Database["public"]["Enums"]["payment_status"];
"requested_at"?: string | null;
"accepted_at"?: string | null;
"arrived_at"?: string | null;
"started_at"?: string | null;
"completed_at"?: string | null;
"cancelled_at"?: string | null;
"cancel_reason"?: string | null;
"cancelled_by"?: Database["public"]["Enums"]["cancelled_by"] | null;
"created_at"?: string;
"updated_at"?: string;
"estimated_distance_km"?: number | null;
"estimated_duration_min"?: number | null;
};
Update: {
"id"?: string;
"company_id"?: string;
"customer_id"?: string;
"driver_id"?: string | null;
"vehicle_type_id"?: string | null;
"pickup_latitude"?: number;
"pickup_longitude"?: number;
"pickup_address"?: string | null;
"destination_latitude"?: number | null;
"destination_longitude"?: number | null;
"destination_address"?: string | null;
"status"?: Database["public"]["Enums"]["request_status"];
"estimated_price"?: number | null;
"final_price"?: number | null;
"fare_breakdown"?: Json | null;
"payment_method"?: Database["public"]["Enums"]["payment_method"];
"payment_status"?: Database["public"]["Enums"]["payment_status"];
"requested_at"?: string | null;
"accepted_at"?: string | null;
"arrived_at"?: string | null;
"started_at"?: string | null;
"completed_at"?: string | null;
"cancelled_at"?: string | null;
"cancel_reason"?: string | null;
"cancelled_by"?: Database["public"]["Enums"]["cancelled_by"] | null;
"created_at"?: string;
"updated_at"?: string;
"estimated_distance_km"?: number | null;
"estimated_duration_min"?: number | null;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "taxi_requests_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["customer_id"], "isOneToOne": false, "foreignKeyName": "taxi_requests_customer_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}, {"columns": ["driver_id"], "isOneToOne": false, "foreignKeyName": "taxi_requests_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}, {"columns": ["vehicle_type_id"], "isOneToOne": false, "foreignKeyName": "taxi_requests_vehicle_type_id_fkey", "referencedColumns": ["id"], "referencedRelation": "vehicle_types"}]; };
"trips": {
Row: {
"id": string;
"request_id": string;
"company_id": string;
"driver_id": string | null;
"customer_id": string;
"distance_km": number | null;
"duration_min": number | null;
"total_amount": number | null;
"payment_method": Database["public"]["Enums"]["payment_method"] | null;
"started_at": string | null;
"ended_at": string | null;
"created_at": string;
};
Insert: {
"id"?: string;
"request_id": string;
"company_id": string;
"driver_id"?: string | null;
"customer_id": string;
"distance_km"?: number | null;
"duration_min"?: number | null;
"total_amount"?: number | null;
"payment_method"?: Database["public"]["Enums"]["payment_method"] | null;
"started_at"?: string | null;
"ended_at"?: string | null;
"created_at"?: string;
};
Update: {
"id"?: string;
"request_id"?: string;
"company_id"?: string;
"driver_id"?: string | null;
"customer_id"?: string;
"distance_km"?: number | null;
"duration_min"?: number | null;
"total_amount"?: number | null;
"payment_method"?: Database["public"]["Enums"]["payment_method"] | null;
"started_at"?: string | null;
"ended_at"?: string | null;
"created_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "trips_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["customer_id"], "isOneToOne": false, "foreignKeyName": "trips_customer_id_fkey", "referencedColumns": ["id"], "referencedRelation": "profiles"}, {"columns": ["driver_id"], "isOneToOne": false, "foreignKeyName": "trips_driver_id_fkey", "referencedColumns": ["id"], "referencedRelation": "drivers"}, {"columns": ["request_id"], "isOneToOne": true, "foreignKeyName": "trips_request_id_fkey", "referencedColumns": ["id"], "referencedRelation": "taxi_requests"}]; };
"vehicle_types": {
Row: {
"id": string;
"company_id": string;
"name": string;
"capacity": number;
"multiplier": number;
"image_url": string | null;
"is_active": boolean;
"created_at": string;
"updated_at": string;
};
Insert: {
"id"?: string;
"company_id": string;
"name": string;
"capacity"?: number;
"multiplier"?: number;
"image_url"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Update: {
"id"?: string;
"company_id"?: string;
"name"?: string;
"capacity"?: number;
"multiplier"?: number;
"image_url"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "vehicle_types_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}]; };
"vehicles": {
Row: {
"id": string;
"company_id": string;
"vehicle_type_id": string | null;
"make": string;
"model": string;
"year": number | null;
"color": string | null;
"registration_number": string;
"capacity": number;
"insurance_expiry_date": string | null;
"inspection_expiry_date": string | null;
"is_active": boolean;
"created_at": string;
"updated_at": string;
};
Insert: {
"id"?: string;
"company_id": string;
"vehicle_type_id"?: string | null;
"make": string;
"model": string;
"year"?: number | null;
"color"?: string | null;
"registration_number": string;
"capacity"?: number;
"insurance_expiry_date"?: string | null;
"inspection_expiry_date"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Update: {
"id"?: string;
"company_id"?: string;
"vehicle_type_id"?: string | null;
"make"?: string;
"model"?: string;
"year"?: number | null;
"color"?: string | null;
"registration_number"?: string;
"capacity"?: number;
"insurance_expiry_date"?: string | null;
"inspection_expiry_date"?: string | null;
"is_active"?: boolean;
"created_at"?: string;
"updated_at"?: string;
};
Relationships: [{"columns": ["company_id"], "isOneToOne": false, "foreignKeyName": "vehicles_company_id_fkey", "referencedColumns": ["id"], "referencedRelation": "companies"}, {"columns": ["vehicle_type_id"], "isOneToOne": false, "foreignKeyName": "vehicles_vehicle_type_id_fkey", "referencedColumns": ["id"], "referencedRelation": "vehicle_types"}]; };
}; Views: {
"geography_columns": { Row: {
"f_table_catalog": string | null;
"f_table_schema": string | null;
"f_table_name": string | null;
"f_geography_column": string | null;
"coord_dimension": number | null;
"srid": number | null;
"type": string | null;
}; Relationships: []; };
"geometry_columns": { Row: {
"f_table_catalog": string | null;
"f_table_schema": string | null;
"f_table_name": string | null;
"f_geometry_column": string | null;
"coord_dimension": number | null;
"srid": number | null;
"type": string | null;
}; Relationships: []; };
}; Functions: {
create_taxi_request: { Args: { p_quote_id: string; p_request_id: string; p_payment_method?: Database["public"]["Enums"]["payment_method"] }; Returns: Database["public"]["Tables"]["taxi_requests"]["Row"] };
register_push_subscription: { Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string }; Returns: undefined };
request_push_recipients: { Args: { p_request_id: string }; Returns: { user_id: string }[] };
}; Enums: {
"cancelled_by": "customer" | "driver" | "admin" | "system";
"discount_type": "percent" | "fixed";
"document_status": "pending" | "approved" | "rejected";
"document_type": "license" | "id_card" | "insurance" | "vehicle_registration";
"driver_status": "available" | "busy" | "offline";
"payment_method": "cash" | "card" | "online";
"payment_status": "pending" | "paid" | "refunded";
"request_status": "pending" | "accepted" | "arrived" | "in_progress" | "completed" | "cancelled";
"transaction_status": "pending" | "completed" | "failed" | "refunded";
"user_role": "CUSTOMER" | "DRIVER" | "COMPANY_ADMIN" | "SUPER_ADMIN";
}; CompositeTypes: { [_ in never]: never }; }; };
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
