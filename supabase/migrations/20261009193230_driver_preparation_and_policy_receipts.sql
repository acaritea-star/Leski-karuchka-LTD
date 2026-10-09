-- Versioned driver terms and short training; mandatory before new verification.
-- Existing verified drivers are not retrospectively locked out by new terms.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE private.driver_policy_versions (
 terms_version text NOT NULL, training_version text NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='object'),
 is_current boolean NOT NULL DEFAULT false,
 published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(terms_version,training_version),
 CHECK(document->>'termsVersion'=terms_version AND document->>'trainingVersion'=training_version)
);
CREATE UNIQUE INDEX driver_policy_one_current ON private.driver_policy_versions(is_current) WHERE is_current;
ALTER TABLE private.driver_policy_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.driver_policy_versions FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.driver_preparation_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 terms_version text NOT NULL, training_version text NOT NULL,
 content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 training_completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(driver_id,company_id,terms_version,training_version),
 FOREIGN KEY(terms_version,training_version) REFERENCES private.driver_policy_versions(terms_version,training_version)
);
CREATE INDEX driver_preparation_user ON public.driver_preparation_acceptances(user_id);
CREATE INDEX driver_preparation_company ON public.driver_preparation_acceptances(company_id);
CREATE INDEX driver_preparation_version ON public.driver_preparation_acceptances(terms_version,training_version);
ALTER TABLE public.driver_preparation_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_preparation_read ON public.driver_preparation_acceptances FOR SELECT TO authenticated USING(
 (user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='DRIVER'))
 OR public.is_company_admin(company_id) OR public.is_super_admin()
);
REVOKE ALL ON public.driver_preparation_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.driver_preparation_acceptances TO authenticated,service_role;

INSERT INTO private.driver_policy_versions(terms_version,training_version,content_hash,document,answers,is_current)
VALUES('2026-10-09-driver.1','2026-10-09.1','5f4e2d7898ff8ca7197dc7929453db805b77cd88b501f8e8fc6a62f1f46f6d53',$driver_document${
  "termsVersion": "2026-10-09-driver.1",
  "trainingVersion": "2026-10-09.1",
  "updatedAt": "9 октомври 2026 г.",
  "title": "Условия за шофьори",
  "intro": "Тези условия уреждат използването на шофьорския профил в leskikaruchka.com. Те допълват Общите условия и не заменят договора между водача и неговата фирма, разрешенията за превоз или задължителните права по закон.",
  "sections": [
    {
      "id": "platform",
      "title": "1. Платформата и превозът",
      "paragraphs": [
        "Лески Каручка предоставя софтуер за свързване на клиенти с водачи и фирми, обработка на заявки и отчети. Лески Каручка не извършва самия превоз. Договорът за превоз е с действителния превозвач, посочен към заявката; водачът действа на приложимото основание към своята фирма.",
        "Водачът и превозвачът отговарят за законното и безопасното извършване на превоза, автомобила, застраховките, необходимите разрешения и документите за плащане. Надписът „верифициран“ е проверка в приложението и не е държавно разрешение или гаранция за пълна законосъобразност.",
        "Контакт за платформата и личните данни: Владимир Атанасов, България, vladiata39@gmail.com, +359890005900. Проверените регистрационни данни и адрес на оператора още не са попълнени в публичната информация. Тези условия не удостоверяват фирмена регистрация и сами по себе си не създават абонамент, комисиона или договор за платен фирмен продукт."
      ]
    },
    {
      "id": "verification",
      "title": "2. Профил, документи и верификация",
      "paragraphs": [
        "Използвай собствен профил с верни данни. Не предоставяй достъп на друг човек. Преди първа верификация завърши подготовката, качи валидни книжка и застраховка и изчакай фирмата да ги одобри и да назначи активен автомобил.",
        "Фирмата и водачът трябва отделно да проверят всички приложими изисквания: удостоверение за водач на таксиметров автомобил, психологическа годност, регистрация и разрешение за съответната община, технически преглед и изискванията към таксиметровия апарат. Две качени снимки не заменят тези проверки.",
        "Не приемай нови заявки с изтекли или невалидни документи. Съобщавай промени на фирмата. Отнемането на верификация спира новите заявки; започнат курс може да бъде приключен, без това да разрешава незаконен или опасен превоз."
      ]
    },
    {
      "id": "availability",
      "title": "3. Онлайн, заявки и безопасност",
      "paragraphs": [
        "„Онлайн“ означава, че си на разположение. „Офлайн“ спира получаването на нови заявки, но не отменя приет курс. Приложението не налага смени и не гарантира брой заявки, доход или непрекъсната наличност.",
        "Приемането важи след потвърждение от сървъра. Отбелязвай „Пристигнах“, начало, край и отказ само когато действително са настъпили. Използвай верен повод за отказ. Не отчиташ приключен превоз, който не е извършен.",
        "Безопасността е първа: работи с телефона само когато е безопасно и съобразно закона. Навигацията не отменя правилата за движение. При непосредствена опасност се свържи с 112; приложението не е спешна служба."
      ]
    },
    {
      "id": "location",
      "title": "4. Местоположение и връзка",
      "paragraphs": [
        "За нови заявки е нужно свежо и достатъчно точно местоположение. Разреши го в браузъра и дръж приложението отворено с работеща връзка. Web/PWA не гарантира GPS и известия при заключен телефон, затворен браузър, ограничен фон или слаб интернет.",
        "Можеш да управляваш споделянето в настройките и в разрешенията на устройството. Изключването не е отказ от лични права; без необходимия GPS приложението не може надеждно да предлага нови заявки. При прекъсване провери актуалния статус след възстановяване на връзката, преди да повториш действие.",
        "По активен курс с приета актуална Политика за поверителност се записват ограничени GPS наблюдения. Суровите точки се изчистват периодично след срока до 7 дни; обобщенията са отделни. GPS, изгладената кола и маршрутът са технически наблюдения, а не доказателство за плащане или измама."
      ]
    },
    {
      "id": "money",
      "title": "5. Цена, плащане и отчет",
      "paragraphs": [
        "Приложението изчислява суми по въведените тарифи и данните за маршрута. Софтуерната сметка не замества задължителен таксиметров апарат, фискален документ или законовите ограничения на тарифите. Водачът и фирмата трябва да спазят приложимите правила и да обяснят дължимата цена на клиента.",
        "Плащането за превоза и издаването на необходимия документ са отговорност на действителния превозвач. Записвай реално получените суми и разходи. Декларирана сума, потвърдено предаване на пари и външен платежен документ са различни доказателства; отчетът не ги представя като едно и също.",
        "Отказана заявка не е автоматично приход. Не отбелязвай фалшиво край, начало, плащане или предадена каса. При разминаване посочи причина и използвай документите на фирмата за сверяване."
      ]
    },
    {
      "id": "data",
      "title": "6. Лични данни и достъп до отчети",
      "paragraphs": [
        "Използвай името, контакта, адресите и местоположението на клиента само за съответната заявка и законно необходимото обслужване. Не ги разпространявай, не прави списъци за реклама и не следи хора извън разрешените функции.",
        "Водачът има достъп до своите заявки и отчети; администраторът на неговата фирма — до данните в обхвата на фирмата. Системната поддръжка обработва данни само при необходимост и разрешен достъп. Основните правила, доставчиците, сроковете и правата са описани в Политиката за поверителност.",
        "Записваме версията и съдържанието на тези условия и обучението, самоличността на профила, фирмата и сървърния час на приемането, за да доказваме предоставената подготовка и договорните действия. Не записваме отговорите от кратката проверка, IP адрес или нов рекламен профил. Записът се пази с профила за тази цел и се разглежда при искане за изтриване съгласно Политиката за поверителност и приложимите законови основания."
      ]
    },
    {
      "id": "matching",
      "title": "7. Как се предлагат заявки",
      "paragraphs": [
        "Водещите условия са активна фирма и профил, верификация, валидни проверки, свободен активен автомобил в подходящата категория, статус онлайн и свеж GPS в радиуса за обслужване. След това водачът може да приеме; едновременните опити се решават от сървъра, така че една заявка да няма двама приели водачи.",
        "Не всеки близък водач непременно получава всяка заявка. Ограничения на категорията, обхвата, наличността, срока и връзката могат да я изключат. Тази версия не предлага плащане за по-предна позиция и не обещава гарантиран пазар. Правата върху собствените ти данни и знаци не се прехвърлят с приемането; необходимият им показ в заявката обслужва превоза."
      ]
    },
    {
      "id": "liability",
      "title": "8. Разпределение и граници на отговорността",
      "paragraphs": [
        "В допустимата от закона степен Лески Каручка, екипът и свързаните с платформата лица не поемат отговорността на водача или превозвача за самия превоз, управление на автомобила, вреди от техни действия, нарушения, липсващи разрешения, неправилно декларирани суми или неизпълнение на договора за превоз.",
        "В допустимата от закона степен платформата не отговаря за пропуснат доход или косвени стопански загуби от липса на заявки и прекъсвания извън нейния контрол, включително проблеми с устройството, GPS, интернет или външни карти. Това не изключва собствените ѝ задължения и отговорност, когато законът ги предвижда.",
        "Нищо в тези условия не изключва или ограничава отговорност за умисъл, груба небрежност, измама или друга отговорност, която законът не позволява да бъде ограничена, включително приложимите права при вреди за живота и здравето, защита на личните данни и задължителни потребителски права. Приемането потвърждава това разпределение; то не е отказ от неотменими права или общо освобождаване за всякакви вреди."
      ]
    },
    {
      "id": "restriction",
      "title": "9. Ограничения, промени и възражения",
      "paragraphs": [
        "Нови заявки могат да бъдат спрени при изтекли документи, отнета верификация, неактивен профил или фирма, липса на надеждно местоположение, нарушения на сигурността, неверни записи или законово изискване. Техническа проверка не е сама по себе си решение, че водачът е извършил измама.",
        "За решение за ограничение, спиране или прекратяване на договорните услуги предоставяме конкретно основание и възможност за възражение чрез контакта по-долу. Когато е приложим Регламент (ЕС) 2019/1150, уведомяването и сроковете са по него, включително най-малко 15 дни за съществени промени на условията и по правило 30 дни за прекратяване на всички услуги. Законовите изключения, например необходимост от незабавно действие за сигурност или изпълнение на законово задължение, се прилагат само когато са налице.",
        "Новите условия не се прилагат със задна дата. Тази първа версия е задължителна преди нова верификация; вече верифицираните водачи могат да преминат подготовката, без автоматично да се спира текущият им достъп заради въвеждането ѝ. Материални бъдещи промени изискват отделно уведомяване и приложимия срок, а не подмяна на стария запис."
      ]
    },
    {
      "id": "contact",
      "title": "10. Контакт и копие",
      "paragraphs": [
        "За въпрос, възражение или несъответствие пиши на vladiata39@gmail.com с номера на заявката и описание, без излишни чувствителни данни. За случая отговаря платформата или фирмата според предмета му. Това не ограничава правото ти да се обърнеш към компетентен орган или съд.",
        "Можеш да прочетеш тези условия преди приемане и след това в „Подготовка за шофьори“, както и да изтеглиш копие с версията и записаното приемане. Прилагат се българското право и задължителните правила на ЕС; не се въвежда задължителен чужд арбитраж."
      ]
    }
  ],
  "steps": [
    { "id": "ready", "title": "Преди първата заявка", "paragraphs": ["Приеми условията и премини тази подготовка. Качи книжка и застраховка със срокове. Фирмата проверява документите и необходимите разрешения, назначава автомобил и верифицира профила.", "Подготовката не е професионална правоспособност. Ако документ или разрешение липсва, не извършвай превоз, дори бутон в приложението да е наличен."] },
    { "id": "online", "title": "Онлайн и местоположение", "paragraphs": ["Пусни „Онлайн“, когато си готов. Разреши местоположение, дръж приложението отворено и връзката включена. При заключен телефон браузърът може да спре GPS и известията.", "Премини „Офлайн“, когато не приемаш нови заявки. Това не приключва вече приетия курс. При прекъсване обнови статуса след възстановяване на връзката."] },
    { "id": "ride", "title": "От приемане до край", "paragraphs": ["Изчакай сървърно потвърждение, че заявката е твоя. „Пристигнах“ е за реално достигане на мястото. Началото е за реално започнат превоз, а краят — за действително приключил курс.", "При отказ избери верния повод. Работи с телефона безопасно. При опасност звъни на 112; не разчитай на приложението като спешна помощ."] },
    { "id": "report", "title": "Честен отчет", "paragraphs": ["GPS и прогнозната цена не доказват получени пари. Следвай задължителния таксиметров апарат и документите за плащане. Декларирай реалните приходи и разходи; сверявай предадената каса с фирмата.", "Отказан курс не е автоматичен приход. При грешка използвай предвидената корекция и причина, вместо да отбелязваш фиктивно плащане или завършен курс."] },
    { "id": "responsibility", "title": "Клиентът и отговорността", "paragraphs": ["Водачът и превозвачът отговарят за безопасния и законен превоз. Платформата предоставя софтуера и отговаря за своите задължения според закона; приемането не заличава неотменими права.", "Пази данните на клиента и ги използвай само за разрешената цел. За проблем по заявката се обърни към фирмата; за проблем със софтуера — към поддръжката."] }
  ],
  "questions": [
    { "id": "background", "title": "Мога ли да разчитам на GPS при заключен телефон?", "options": [{ "id": "guaranteed", "label": "Да, браузърното разрешение гарантира работа във фон." }, { "id": "foreground", "label": "Не. Държа приложението отворено и проверявам връзката и GPS." }] },
    { "id": "cash", "title": "GPS и приключена заявка доказват ли получени пари?", "options": [{ "id": "proof", "label": "Да, отчетът е доказана каса." }, { "id": "reconcile", "label": "Не. Записвам реалното плащане и го сверявам с документите." }] },
    { "id": "responsibility", "title": "Кой отговаря за самия превоз?", "options": [{ "id": "carrier", "label": "Действителният превозвач и водачът; платформата има свои задължения по закон." }, { "id": "nobody", "label": "След приемане на условията никой не носи отговорност." }] }
  ]
}
$driver_document$::jsonb,'{"background":"foreground","cash":"reconcile","responsibility":"carrier"}'::jsonb,true);

CREATE OR REPLACE FUNCTION private.driver_preparation_status(p_driver uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE d public.drivers; version private.driver_policy_versions; receipt public.driver_preparation_acceptances;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_driver(d.id) OR public.is_company_admin(d.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до подготовката на този шофьор.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT version FROM private.driver_policy_versions WHERE is_current;
 SELECT * INTO receipt FROM public.driver_preparation_acceptances
  WHERE driver_id=d.id AND user_id=d.user_id AND company_id=d.company_id
   AND terms_version=version.terms_version AND training_version=version.training_version AND content_hash=version.content_hash;
 RETURN jsonb_build_object('complete',receipt.id IS NOT NULL,'terms_version',version.terms_version,
  'training_version',version.training_version,'accepted_at',receipt.accepted_at,'training_completed_at',receipt.training_completed_at);
END $function$;

CREATE OR REPLACE FUNCTION private.driver_preparation_materials()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE d public.drivers; version private.driver_policy_versions; receipt public.driver_preparation_acceptances;
BEGIN
 SELECT d1.* INTO d FROM public.drivers d1 JOIN public.profiles p ON p.id=d1.user_id
  WHERE d1.user_id=auth.uid() AND p.is_active AND p.role='DRIVER' AND p.company_id=d1.company_id;
 IF auth.uid() IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Подготовката е достъпна с активен шофьорски профил.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT version FROM private.driver_policy_versions WHERE is_current;
 SELECT * INTO receipt FROM public.driver_preparation_acceptances WHERE driver_id=d.id AND user_id=d.user_id AND company_id=d.company_id
  AND terms_version=version.terms_version AND training_version=version.training_version AND content_hash=version.content_hash;
 RETURN jsonb_build_object('driver_id',d.id,'user_id',d.user_id,'company_id',d.company_id,'document',version.document,'content_hash',version.content_hash,
  'receipt',CASE WHEN receipt.id IS NULL THEN NULL ELSE to_jsonb(receipt) END);
END $function$;

CREATE OR REPLACE FUNCTION private.accept_driver_preparation(p_driver uuid,p_terms text,p_training text,p_hash text,p_answers jsonb,p_general_terms text,p_general_privacy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE d public.drivers; version private.driver_policy_versions; receipt public.driver_preparation_acceptances; general_id uuid;
BEGIN
 -- Pin the real account and driver; an admin cannot accept on a driver's behalf.
 SELECT d1.* INTO d FROM public.drivers d1 JOIN public.profiles p ON p.id=d1.user_id
  WHERE d1.id=p_driver AND d1.user_id=auth.uid() AND p.is_active AND p.role='DRIVER' AND p.company_id=d1.company_id FOR SHARE OF d1;
 IF auth.uid() IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Само шофьорът може да приеме своите условия.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT version FROM private.driver_policy_versions WHERE is_current FOR SHARE;
 IF (p_terms,p_training,p_hash) IS DISTINCT FROM (version.terms_version,version.training_version,version.content_hash) THEN
  RAISE EXCEPTION 'Условията са обновени. Прочети текущата версия преди приемане.' USING ERRCODE='22023';
 END IF;
 IF p_answers IS NULL OR p_answers IS DISTINCT FROM version.answers THEN
  RAISE EXCEPTION 'Прегледай обучението и трите отговора. Не всички са верни.' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.legal_versions v WHERE v.is_current AND v.terms_version=p_general_terms AND v.privacy_version=p_general_privacy) THEN
  RAISE EXCEPTION 'Общите условия са обновени. Обнови приложението преди приемане.' USING ERRCODE='22023';
 END IF;
 general_id:=private.accept_legal_versions(p_general_terms,p_general_privacy,'continue');
 INSERT INTO public.driver_preparation_acceptances(driver_id,user_id,company_id,terms_version,training_version,content_hash)
 VALUES(d.id,d.user_id,d.company_id,version.terms_version,version.training_version,version.content_hash)
 ON CONFLICT(driver_id,company_id,terms_version,training_version) DO NOTHING;
 SELECT * INTO STRICT receipt FROM public.driver_preparation_acceptances WHERE driver_id=d.id AND company_id=d.company_id
  AND terms_version=version.terms_version AND training_version=version.training_version;
 RETURN to_jsonb(receipt)||jsonb_build_object('general_acceptance_id',general_id);
END $function$;

CREATE OR REPLACE FUNCTION public.driver_preparation_materials()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
 SELECT private.driver_preparation_materials();
$function$;
CREATE OR REPLACE FUNCTION public.accept_driver_preparation(p_driver uuid,p_terms text,p_training text,p_hash text,p_answers jsonb,p_general_terms text,p_general_privacy text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $function$
 SELECT private.accept_driver_preparation(p_driver,p_terms,p_training,p_hash,p_answers,p_general_terms,p_general_privacy);
$function$;
REVOKE ALL ON FUNCTION private.driver_preparation_status(uuid),private.driver_preparation_materials(),
 private.accept_driver_preparation(uuid,text,text,text,jsonb,text,text),public.driver_preparation_materials(),
 public.accept_driver_preparation(uuid,text,text,text,jsonb,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.driver_preparation_status(uuid),private.driver_preparation_materials(),
 private.accept_driver_preparation(uuid,text,text,text,jsonb,text,text),public.driver_preparation_materials(),
 public.accept_driver_preparation(uuid,text,text,text,jsonb,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.driver_verification_report(p_driver uuid, p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; c public.companies; v public.vehicles; doc public.driver_documents;
 blockers jsonb:='[]'; warnings jsonb:='[]'; documents jsonb:='{}'; kind text; label text; state text;
 preparation jsonb;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF NOT FOUND THEN RETURN jsonb_build_object('driver_id',p_driver,'can_verify',false,'blockers',jsonb_build_array(jsonb_build_object('code','profile','message','Няма шофьорски профил.')),'warnings','[]'::jsonb,'documents','{}'::jsonb); END IF;
 SELECT * INTO c FROM public.companies WHERE id=d.company_id;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle AND company_id=d.company_id;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=d.user_id AND role='DRIVER' AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','profile','message','Шофьорският профил не е активен към тази фирма.')); END IF;
 IF c.id IS NULL OR NOT c.is_active THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company','message','Фирмата не е активна.')); END IF;
 IF v.id IS NULL OR NOT v.is_active OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=v.vehicle_type_id AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle','message','Назначете активен автомобил с активна категория от същата фирма.')); END IF;
 preparation:=private.driver_preparation_status(d.id);
 IF NOT (preparation->>'complete')::boolean THEN
  IF NOT d.is_verified THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','preparation','message','Шофьорът трябва лично да приеме условията за шофьори и да завърши кратката подготовка.'));
  ELSE warnings:=warnings||jsonb_build_array(jsonb_build_object('code','preparation','message','Достъпна е нова подготовка в шофьорския профил. Текущата верификация не се отнема автоматично.')); END IF;
 END IF;
 FOREACH kind IN ARRAY ARRAY['license','insurance'] LOOP
  label:=CASE kind WHEN 'license' THEN 'Шофьорска книжка' ELSE 'Застраховка' END;
  SELECT x.* INTO doc FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=kind
   ORDER BY (x.status='approved' AND x.expires_at>=today) DESC NULLS LAST,x.created_at DESC,x.id DESC LIMIT 1;
  state:=CASE WHEN NOT FOUND THEN 'missing' WHEN doc.expires_at IS NULL THEN 'missing_expiry'
   WHEN doc.expires_at<today THEN 'expired' WHEN doc.status='rejected' THEN 'rejected'
   WHEN doc.status<>'approved' THEN 'pending'
   WHEN NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-documents' AND doc.file_url='storage://driver-documents/'||o.name) THEN 'missing_file'
   ELSE 'approved' END;
  documents:=documents||jsonb_build_object(kind,jsonb_build_object('state',state,'expires_at',doc.expires_at));
  IF state<>'approved' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code',kind,'message',label||': '||CASE state
   WHEN 'missing' THEN 'няма качен документ.' WHEN 'missing_expiry' THEN 'липсва срок на валидност.'
   WHEN 'expired' THEN 'срокът е изтекъл.' WHEN 'rejected' THEN 'документът е отхвърлен.'
   WHEN 'pending' THEN 'чака одобрение от фирмата.' ELSE 'защитеният файл липсва.' END)); END IF;
 END LOOP;
 IF c.permit_expires_on<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company_permit','message','Срокът на разрешението на фирмата е изтекъл.'));
 ELSIF c.id IS NOT NULL AND c.permit_expires_on IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','company_permit','message','Не е въведен срок на разрешението на фирмата. Проверете го в „Настройки“.')); END IF;
 IF v.insurance_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Срокът на застраховката на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.insurance_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Не е въведен срок на застраховката на автомобила.')); END IF;
 IF v.inspection_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Срокът на техническия преглед на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.inspection_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Не е въведен срок на техническия преглед на автомобила.')); END IF;
 RETURN jsonb_build_object('driver_id',d.id,'is_verified',d.is_verified,'can_verify',jsonb_array_length(blockers)=0,'blockers',blockers,'warnings',warnings,'documents',documents,'preparation',preparation);
END $function$;



CREATE OR REPLACE FUNCTION public.export_my_basic_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('generated_at',clock_timestamp(),'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=uid),
 'driver_applications',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_applications WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'legal_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.legal_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'driver_preparation_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_preparation_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'privacy_requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.privacy_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'money_entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_money_entries WHERE driver_user_id=uid ORDER BY recorded_at DESC LIMIT 1000)x),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,created_at,pickup_address,destination_address,estimated_price FROM public.taxi_requests WHERE customer_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $function$;


NOTIFY pgrst, 'reload schema';
COMMIT;
