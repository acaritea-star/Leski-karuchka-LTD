"""Fallback: build application table types from a verified Postgres catalog snapshot.
Usage: python3 scripts/types-from-schema.py schema-current.json src/lib/database.types.ts
The normal Supabase types endpoint failed with 'JWT issued at future' during this upgrade.
"""
import json,sys,collections
s=json.load(open(sys.argv[1])); enums=collections.defaultdict(list); tables=collections.defaultdict(list)
for e in s['enums']: enums[e['type']].append(e['label'])
for c in s['columns']: tables[c['table_name']].append(c)
def typ(c):
 u=c['udt_name']; d=c['data_type']
 if u in enums: return 'Database["public"]["Enums"]['+json.dumps(u)+']'
 if d=='ARRAY': return 'string[]'
 if d in ('json','jsonb'): return 'Json'
 if d=='boolean': return 'boolean'
 if d in ('smallint','integer','bigint','numeric','real','double precision'): return 'number'
 if d=='USER-DEFINED': return 'unknown'
 return 'string'
a=['// Generated from the live Postgres catalog; do not edit table definitions by hand.','export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];','export type Database = { public: { Tables: {']
for name,cols in sorted(tables.items()):
 if name in s.get('views',[]): continue
 a.append(json.dumps(name)+': {')
 for mode in ['Row','Insert','Update']:
  a.append(mode+': {')
  for c in sorted(cols,key=lambda c:c['ordinal_position']):
   optional=mode=='Update' or mode=='Insert' and (c['is_nullable']=='YES' or c['column_default'] is not None or c['is_identity']=='YES' or c['is_generated']!='NEVER')
   a.append(json.dumps(c['column_name'])+('?' if optional else '')+': '+typ(c)+(' | null' if c['is_nullable']=='YES' else '')+';')
  a.append('};')
 fk=[{k:v for k,v in f.items() if k!='table'} for f in s['foreign_keys'] if f['table']==name]
 a.append('Relationships: '+json.dumps(fk)+'; };')
a.append('}; Views: {')
for name in sorted(s.get('views',[])):
 a.append(json.dumps(name)+': { Row: {')
 for c in sorted(tables[name],key=lambda c:c['ordinal_position']):
  a.append(json.dumps(c['column_name'])+': '+typ(c)+(' | null' if c['is_nullable']=='YES' else '')+';')
 a.append('}; Relationships: []; };')
a.append('''}; Functions: {
create_taxi_request: { Args: { p_quote_id: string; p_request_id: string; p_payment_method?: Database["public"]["Enums"]["payment_method"] }; Returns: Database["public"]["Tables"]["taxi_requests"]["Row"] };
register_push_subscription: { Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string }; Returns: undefined };
request_push_recipients: { Args: { p_request_id: string }; Returns: { user_id: string }[] };
}; Enums: {''')
for name,labels in sorted(enums.items()):a.append(json.dumps(name)+': '+' | '.join(map(json.dumps,labels))+';')
a+=['}; CompositeTypes: { [_ in never]: never }; }; };','export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];','export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];','export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];','export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];']
open(sys.argv[2],'w').write('\n'.join(a)+'\n')
