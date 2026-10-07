import { useQuery } from '@tanstack/react-query';
import { loadCarrier } from '@/lib/legalWorkflow';
export default function CarrierIdentity({companyId}:{companyId?:string}) {
 const query=useQuery({queryKey:['carrier-identity',companyId],enabled:!!companyId,staleTime:60_000,queryFn:({signal})=>loadCarrier(companyId!,signal)});
 if(!companyId)return null;
 const c=query.data;
 return <p className="text-xs text-foreground-700 leading-relaxed px-1 py-2" aria-label="Превозвач">
  {c?<><strong>Превозвач: {c.legal_name||c.name}</strong>{c.registration_id&&<> · ЕИК {c.registration_id}</>}{c.phone&&<> · {c.phone}</>}
   <span className="block text-foreground-500">{c.verified?'Идентичността и посоченото разрешение са проверени.':'Данните на превозвача очакват проверка.'}</span></>
   :query.isError?<>Данните на превозвача не се заредиха. <button className="underline" onClick={()=>void query.refetch()}>Опитай отново</button></>:'Зареждане на данните на превозвача…'}
 </p>;
}
