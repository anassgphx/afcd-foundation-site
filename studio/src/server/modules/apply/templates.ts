// Built-in form templates. They are starting points, read-only in Studio: "Use" copies one into a call's form and
// "Duplicate" makes an editable copy in the templates library. Texts are generic questions, never AFCD facts.
import type { Field, FormDef, Lang, Page, Rule } from './engine.ts';

const L = (en: string, fr: string, ar: string): Lang => ({ en, fr, ar });
const opt = (value: string, en: string, fr: string, ar: string) => ({ value, label: L(en, fr, ar) });
const f = (id: string, type: Field['type'], label: Lang, extra: Partial<Field> = {}): Field => ({ id, type, label, ...extra });
const page = (id: string, title: Lang, fields: Field[], description?: Lang): Page => ({ id, title, fields, ...(description ? { description } : {}) });

// ---------------------------------------------------------------- shared blocks
const contact = (extra: Field[] = []): Page => page('about_you', L('About you', 'Vous concernant', 'معلومات عنك'), [
  f('full_name', 'short_text', L('Full name', 'Nom complet', 'الاسم الكامل'), { required: true, config: { maxLength: 120 }, appearance: { width: 'half' } }),
  f('email', 'email', L('Email', 'E-mail', 'البريد الإلكتروني'), { required: true, appearance: { width: 'half' } }),
  f('phone', 'phone', L('Phone (WhatsApp if possible)', 'Téléphone (WhatsApp si possible)', 'الهاتف (واتساب إن أمكن)'), { appearance: { width: 'half' } }),
  f('city', 'short_text', L('Town or city', 'Ville ou commune', 'المدينة أو الجماعة'), { required: true, config: { maxLength: 80 }, appearance: { width: 'half' } }),
  ...extra,
]);
const consent = (): Page => page('consent', L('Consent', 'Consentement', 'الموافقة'), [
  f('privacy_info', 'statement', L('', '', ''), { config: { text: L('We use your answers only to assess this application and to contact you about it. The privacy notice on the call page explains who sees them and how long they are kept.',
    'Vos réponses servent uniquement à évaluer cette candidature et à vous contacter à son sujet. L’avis de confidentialité de l’appel précise qui les consulte et combien de temps elles sont conservées.',
    'نستخدم إجاباتك فقط لتقييم هذا الطلب والتواصل معك بشأنه. يوضح إشعار الخصوصية في صفحة الدعوة من يطلع عليها ومدة الاحتفاظ بها.') } }),
  f('consent_privacy', 'consent', L('I have read the privacy notice and agree to my data being used for this application.', 'J’ai lu l’avis de confidentialité et j’accepte que mes données soient utilisées pour cette candidature.', 'قرأت إشعار الخصوصية وأوافق على استخدام بياناتي لهذا الطلب.'), { required: true }),
  f('consent_truth', 'consent', L('I confirm the information I gave is true.', 'Je confirme que les informations fournies sont exactes.', 'أؤكد أن المعلومات التي قدمتها صحيحة.'), { required: true }),
]);
const settings = (): FormDef['settings'] => ({ languages: ['en', 'fr', 'ar'], reviewStep: true,
  confirmation: L('Thank you. Your application was received. We will contact you by email.', 'Merci. Votre candidature a bien été reçue. Nous vous contacterons par e-mail.', 'شكرًا لك. تم استلام طلبك. سنتواصل معك عبر البريد الإلكتروني.') });
const age = f('age', 'number', L('Age', 'Âge', 'العمر'), { required: true, config: { min: 10, max: 99, step: 1 }, appearance: { width: 'half' } });
const ageRule = (min: number, max: number): Rule => ({ id: 'age_range', name: `Age ${min}–${max}`, when: { any: [{ field: 'age', op: 'lt', value: min }, { field: 'age', op: 'gt', value: max }] },
  then: [{ type: 'eligibility', result: 'ineligible', reason: L(`Outside the ${min}–${max} age range`, `Hors de la tranche ${min}–${max} ans`, `خارج الفئة العمرية ${min}–${max}`) },
    { type: 'message', tone: 'warning', page: 'about_you', message: L(`This call is for people aged ${min} to ${max}. You can still apply; the team will check your situation.`, `Cet appel s’adresse aux personnes de ${min} à ${max} ans. Vous pouvez tout de même postuler ; l’équipe examinera votre situation.`, `هذه الدعوة موجهة للأشخاص من ${min} إلى ${max} سنة. يمكنك التقديم مع ذلك وسيدرس الفريق وضعك.`) }] });
const cv = (required = true) => f('cv', 'file', L('CV (PDF)', 'CV (PDF)', 'السيرة الذاتية (PDF)'), { required, config: { accept: ['pdf'], maxMb: 5, maxFiles: 1 } });
const why = (en: string, fr: string, ar: string) => f('motivation', 'long_text', L(en, fr, ar), { required: true, config: { minLength: 100, maxLength: 3000 }, appearance: { rows: 6 } });
const yn = (id: string, en: string, fr: string, ar: string, extra: Partial<Field> = {}) => f(id, 'yes_no', L(en, fr, ar), { required: true, ...extra });

export type BuiltInTemplate = { key: string; name: string; description: string; category: string; version: number; definition: FormDef };

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  { key: 'youth_program', name: 'Youth programme', category: 'youth_program', version: 1, description: 'Young participants: contact details, age check, motivation and past involvement.',
    definition: { schema: 1, settings: settings(), pages: [contact([age]),
      page('motivation_page', L('Your motivation', 'Votre motivation', 'دوافعك'), [
        why('Why do you want to join this programme?', 'Pourquoi voulez-vous rejoindre ce programme ?', 'لماذا تريد الانضمام إلى هذا البرنامج؟'),
        yn('volunteered', 'Have you volunteered or taken part in a community project before?', 'Avez-vous déjà fait du bénévolat ou participé à un projet communautaire ?', 'هل سبق لك التطوع أو المشاركة في مشروع مجتمعي؟'),
        f('volunteer_details', 'long_text', L('Tell us about it', 'Racontez-nous', 'حدثنا عن ذلك'), { required: true, config: { maxLength: 1500 } }),
        f('availability', 'multi_choice', L('When are you available?', 'Quand êtes-vous disponible ?', 'متى تكون متاحًا؟'), { required: true, config: { options: [opt('weekdays', 'Weekdays', 'En semaine', 'أيام الأسبوع'), opt('saturday', 'Saturday', 'Samedi', 'السبت'), opt('sunday', 'Sunday', 'Dimanche', 'الأحد')] }, appearance: { display: 'checkbox' } }),
      ]), consent()],
      rules: [ageRule(18, 30), { id: 'show_volunteer_details', name: 'Ask for details when they volunteered', when: { field: 'volunteered', op: 'equals', value: true }, then: [{ type: 'show', target: { kind: 'field', id: 'volunteer_details' } }] }] } },

  { key: 'fellowship', name: 'Fellowship', category: 'fellowship', version: 1, description: 'Selective fellowship: background, project idea, CV and a reference.',
    definition: { schema: 1, settings: settings(), pages: [contact([age]),
      page('background', L('Background', 'Parcours', 'الخلفية'), [
        f('education', 'single_choice', L('Highest level of education', 'Niveau d’études le plus élevé', 'أعلى مستوى تعليمي'), { required: true, config: { options: [opt('secondary', 'Secondary school', 'Secondaire', 'ثانوي'), opt('bachelor', 'Bachelor', 'Licence', 'إجازة'), opt('master', 'Master or higher', 'Master ou plus', 'ماستر أو أعلى'), opt('other', 'Other', 'Autre', 'أخرى')] }, appearance: { display: 'dropdown' } }),
        f('current_role', 'short_text', L('Current occupation', 'Occupation actuelle', 'المهنة الحالية'), { config: { maxLength: 160 } }), cv(),
      ]),
      page('project', L('Your project idea', 'Votre idée de projet', 'فكرة مشروعك'), [
        f('project_title', 'short_text', L('Project title', 'Titre du projet', 'عنوان المشروع'), { required: true, config: { maxLength: 120 } }),
        f('project_summary', 'long_text', L('What problem does it address, and for whom?', 'Quel problème traite-t-il, et pour qui ?', 'ما المشكلة التي يعالجها ولمن؟'), { required: true, config: { minLength: 150, maxLength: 3000 }, appearance: { rows: 7 } }),
        why('Why this fellowship, and why now?', 'Pourquoi cette bourse, et pourquoi maintenant ?', 'لماذا هذه الزمالة ولماذا الآن؟'),
        f('referee_email', 'email', L('Email of a referee', 'E-mail d’une personne de référence', 'بريد مرجع'), { help: L('Someone who knows your work. We contact them only if you are shortlisted.', 'Une personne qui connaît votre travail, contactée seulement si vous êtes présélectionné·e.', 'شخص يعرف عملك، نتواصل معه فقط إذا تم اختيارك مبدئيًا.') }),
      ]), consent()],
      rules: [ageRule(18, 35)] } },

  { key: 'training', name: 'Training', category: 'training', version: 1, description: 'Short course registration: level, availability and expectations.',
    definition: { schema: 1, settings: settings(), pages: [contact(),
      page('training_page', L('The training', 'La formation', 'التكوين'), [
        f('level', 'single_choice', L('Your current level in this subject', 'Votre niveau actuel dans ce domaine', 'مستواك الحالي في هذا المجال'), { required: true, config: { options: [opt('beginner', 'Beginner', 'Débutant', 'مبتدئ'), opt('intermediate', 'Intermediate', 'Intermédiaire', 'متوسط'), opt('advanced', 'Advanced', 'Avancé', 'متقدم')] } }),
        yn('full_attendance', 'Can you attend every session?', 'Pouvez-vous assister à toutes les séances ?', 'هل يمكنك حضور جميع الحصص؟'),
        f('expectations', 'long_text', L('What do you hope to learn?', 'Qu’espérez-vous apprendre ?', 'ماذا تأمل أن تتعلم؟'), { config: { maxLength: 1500 } }),
      ]), consent()],
      rules: [{ id: 'attendance_note', name: 'Attendance warning', when: { field: 'full_attendance', op: 'equals', value: false }, then: [{ type: 'message', tone: 'warning', page: 'training_page', message: L('Places go first to people who can attend every session.', 'Les places sont attribuées en priorité aux personnes présentes à toutes les séances.', 'تُمنح الأماكن أولًا لمن يستطيع حضور جميع الحصص.') }, { type: 'eligibility', result: 'needs_review', reason: L('Cannot attend every session', 'Ne peut pas assister à toutes les séances', 'لا يستطيع حضور جميع الحصص') }] }] } },

  { key: 'volunteer', name: 'Volunteer', category: 'volunteer', version: 1, description: 'Volunteers: areas of interest, time available and skills.',
    definition: { schema: 1, settings: settings(), pages: [contact([age]),
      page('volunteering', L('Volunteering', 'Bénévolat', 'التطوع'), [
        f('areas', 'multi_choice', L('Where would you like to help?', 'Où souhaitez-vous aider ?', 'أين تود المساعدة؟'), { required: true, config: { minSelected: 1, options: [opt('events', 'Events', 'Événements', 'الفعاليات'), opt('education', 'Education and tutoring', 'Éducation et soutien scolaire', 'التعليم والدعم'), opt('environment', 'Environment', 'Environnement', 'البيئة'), opt('communication', 'Communication', 'Communication', 'التواصل')] } }),
        f('hours', 'number', L('Hours per week you can give', 'Heures par semaine disponibles', 'عدد الساعات الأسبوعية المتاحة'), { required: true, config: { min: 1, max: 40, step: 1 } }),
        f('skills', 'long_text', L('Skills you would like to share', 'Compétences que vous souhaitez partager', 'المهارات التي تود مشاركتها'), { config: { maxLength: 1500 } }),
      ]), consent()],
      rules: [{ id: 'minors', name: 'Minors need a guardian', when: { field: 'age', op: 'lt', value: 18 }, then: [{ type: 'message', tone: 'info', page: 'about_you', message: L('Volunteers under 18 need written permission from a parent or guardian. We will send you the form.', 'Les bénévoles de moins de 18 ans ont besoin de l’accord écrit d’un parent ou tuteur. Nous vous enverrons le formulaire.', 'يحتاج المتطوعون دون 18 سنة إلى إذن كتابي من ولي الأمر. سنرسل لك الاستمارة.') }, { type: 'eligibility', result: 'needs_review', reason: L('Under 18: guardian permission needed', 'Moins de 18 ans : accord parental requis', 'دون 18 سنة: يلزم إذن ولي الأمر') }] }] } },

  { key: 'recruitment', name: 'Recruitment', category: 'recruitment', version: 1, description: 'Job application: position, experience, CV and cover letter.',
    definition: { schema: 1, settings: settings(), pages: [contact(),
      page('application', L('Your application', 'Votre candidature', 'طلبك'), [
        f('experience_years', 'number', L('Years of relevant experience', 'Années d’expérience pertinente', 'سنوات الخبرة ذات الصلة'), { required: true, config: { min: 0, max: 60, step: 1 } }),
        f('languages', 'multi_choice', L('Working languages', 'Langues de travail', 'لغات العمل'), { required: true, config: { options: [opt('ar', 'Arabic', 'Arabe', 'العربية'), opt('amz', 'Amazigh', 'Amazighe', 'الأمازيغية'), opt('fr', 'French', 'Français', 'الفرنسية'), opt('en', 'English', 'Anglais', 'الإنجليزية')] } }),
        cv(), f('cover_letter', 'file', L('Cover letter (PDF)', 'Lettre de motivation (PDF)', 'رسالة التحفيز (PDF)'), { required: true, config: { accept: ['pdf'], maxMb: 5, maxFiles: 1 } }),
        f('start_date', 'date', L('Earliest start date', 'Date de début possible', 'أقرب تاريخ للبدء'), { required: true }),
      ]), consent()], rules: [] } },

  { key: 'grant', name: 'Grant', category: 'grant', version: 1, description: 'Small grants: organisation, project, budget lines with a calculated total.',
    definition: { schema: 1, settings: settings(), pages: [
      page('organisation', L('Organisation', 'Organisation', 'الجمعية'), [
        f('org_name', 'short_text', L('Organisation name', 'Nom de l’organisation', 'اسم الجمعية'), { required: true, config: { maxLength: 160 } }),
        f('contact_name', 'short_text', L('Contact person', 'Personne de contact', 'الشخص المسؤول'), { required: true, appearance: { width: 'half' } }),
        f('email', 'email', L('Email', 'E-mail', 'البريد الإلكتروني'), { required: true, appearance: { width: 'half' } }),
        yn('registered', 'Is the organisation legally registered?', 'L’organisation est-elle légalement enregistrée ?', 'هل الجمعية مسجلة قانونيًا؟'),
      ]),
      page('project', L('Project', 'Projet', 'المشروع'), [
        f('project_title', 'short_text', L('Project title', 'Titre du projet', 'عنوان المشروع'), { required: true, config: { maxLength: 160 } }),
        f('project_summary', 'long_text', L('Summary: aims, activities, who benefits', 'Résumé : objectifs, activités, bénéficiaires', 'ملخص: الأهداف والأنشطة والمستفيدون'), { required: true, config: { minLength: 150, maxLength: 4000 }, appearance: { rows: 8 } }),
        f('beneficiaries', 'number', L('Expected number of beneficiaries', 'Nombre de bénéficiaires prévu', 'العدد المتوقع للمستفيدين'), { required: true, config: { min: 1, step: 1 } }),
      ]),
      page('budget', L('Budget (MAD)', 'Budget (MAD)', 'الميزانية (درهم)'), [
        f('budget_staff', 'number', L('Staff and fees', 'Personnel et honoraires', 'الموظفون والأتعاب'), { required: true, config: { min: 0 }, appearance: { width: 'half' } }),
        f('budget_equipment', 'number', L('Equipment', 'Équipement', 'المعدات'), { required: true, config: { min: 0 }, appearance: { width: 'half' } }),
        f('budget_activities', 'number', L('Activities', 'Activités', 'الأنشطة'), { required: true, config: { min: 0 }, appearance: { width: 'half' } }),
        f('budget_other', 'number', L('Other costs', 'Autres coûts', 'تكاليف أخرى'), { config: { min: 0 }, appearance: { width: 'half' } }),
        f('budget_total', 'calculated', L('Total budget', 'Budget total', 'مجموع الميزانية'), { config: { expr: { op: 'sum', args: [{ field: 'budget_staff' }, { field: 'budget_equipment' }, { field: 'budget_activities' }, { field: 'budget_other' }] }, decimals: 2, unit: 'MAD' } }),
        f('amount_requested', 'number', L('Amount requested', 'Montant demandé', 'المبلغ المطلوب'), { required: true, config: { min: 0 } }),
        f('cofunding', 'calculated', L('Co-funding (total minus amount requested)', 'Cofinancement (total moins montant demandé)', 'التمويل المشترك (المجموع ناقص المبلغ المطلوب)'), { config: { expr: { op: 'sub', args: [{ field: 'budget_total' }, { field: 'amount_requested' }] }, decimals: 2, unit: 'MAD' } }),
        f('budget_file', 'file', L('Detailed budget (PDF or XLSX)', 'Budget détaillé (PDF ou XLSX)', 'الميزانية المفصلة (PDF أو XLSX)'), { config: { accept: ['pdf', 'sheet'], maxMb: 10, maxFiles: 1 } }),
      ]), consent()],
      rules: [
        { id: 'over_total', name: 'Request above the total', when: { field: 'cofunding', op: 'lt', value: 0 }, then: [
          { type: 'message', tone: 'warning', page: 'budget', message: L('The amount requested is higher than the total budget.', 'Le montant demandé dépasse le budget total.', 'المبلغ المطلوب أعلى من مجموع الميزانية.') },
          { type: 'eligibility', result: 'needs_review', reason: L('Request above the total budget', 'Demande supérieure au budget total', 'طلب يفوق مجموع الميزانية') }] },
        { id: 'not_registered', name: 'Unregistered organisations', when: { field: 'registered', op: 'equals', value: false }, then: [{ type: 'eligibility', result: 'needs_review', reason: L('Organisation not registered', 'Organisation non enregistrée', 'جمعية غير مسجلة') }] },
      ] } },

  { key: 'startup', name: 'Start-up / incubation', category: 'startup', version: 1, description: 'Early-stage ventures: stage, team, pitch deck.',
    definition: { schema: 1, settings: settings(), pages: [contact(),
      page('venture', L('Your venture', 'Votre projet', 'مشروعك'), [
        f('venture_name', 'short_text', L('Name of the venture', 'Nom du projet', 'اسم المشروع'), { required: true, config: { maxLength: 120 } }),
        f('stage', 'single_choice', L('Stage', 'Stade', 'المرحلة'), { required: true, config: { options: [opt('idea', 'Idea', 'Idée', 'فكرة'), opt('prototype', 'Prototype', 'Prototype', 'نموذج أولي'), opt('revenue', 'First customers', 'Premiers clients', 'أول الزبائن')] }, appearance: { display: 'buttons' } }),
        f('team_size', 'number', L('People in the team', 'Personnes dans l’équipe', 'عدد أعضاء الفريق'), { required: true, config: { min: 1, max: 100, step: 1 } }),
        f('problem', 'long_text', L('Which problem do you solve, and for whom?', 'Quel problème résolvez-vous, et pour qui ?', 'ما المشكلة التي تحلها ولمن؟'), { required: true, config: { minLength: 100, maxLength: 3000 } }),
        f('pitch_deck', 'file', L('Pitch deck (PDF)', 'Présentation (PDF)', 'العرض التقديمي (PDF)'), { config: { accept: ['pdf'], maxMb: 15, maxFiles: 1 } }),
      ]), consent()],
      rules: [{ id: 'deck_for_revenue', name: 'Deck required after the idea stage', when: { field: 'stage', op: 'not_equals', value: 'idea' }, then: [{ type: 'require', field: 'pitch_deck' }] }] } },

  { key: 'event', name: 'Event participation', category: 'event', version: 1, description: 'Registration for an event: attendance, accessibility and practical needs.',
    definition: { schema: 1, settings: settings(), pages: [contact(),
      page('participation', L('Participation', 'Participation', 'المشاركة'), [
        f('attendance', 'single_choice', L('How will you attend?', 'Comment participerez-vous ?', 'كيف ستشارك؟'), { required: true, config: { options: [opt('in_person', 'In person', 'En présentiel', 'حضوريًا'), opt('online', 'Online', 'En ligne', 'عن بعد')] } }),
        yn('needs_access', 'Do you need any accessibility support?', 'Avez-vous besoin d’un accompagnement en matière d’accessibilité ?', 'هل تحتاج إلى دعم في الولوجية؟'),
        f('access_details', 'long_text', L('What would help you take part?', 'Qu’est-ce qui faciliterait votre participation ?', 'ما الذي سيساعدك على المشاركة؟'), { config: { maxLength: 1000 }, private: true }),
        f('dietary', 'short_text', L('Dietary requirements', 'Régime alimentaire', 'متطلبات غذائية'), { config: { maxLength: 200 } }),
      ]), consent()],
      rules: [
        { id: 'access', name: 'Accessibility details', when: { field: 'needs_access', op: 'equals', value: true }, then: [{ type: 'show', target: { kind: 'field', id: 'access_details' } }] },
        { id: 'online_no_food', name: 'No catering question online', when: { field: 'attendance', op: 'equals', value: 'online' }, then: [{ type: 'hide', target: { kind: 'field', id: 'dietary' } }] },
      ] } },

  { key: 'expert', name: 'Call for experts', category: 'expert', version: 1, description: 'Consultants and trainers: expertise, experience, daily rate, CV.',
    definition: { schema: 1, settings: settings(), pages: [contact(),
      page('expertise', L('Expertise', 'Expertise', 'الخبرة'), [
        f('fields', 'multi_choice', L('Areas of expertise', 'Domaines d’expertise', 'مجالات الخبرة'), { required: true, config: { minSelected: 1, maxSelected: 3, options: [opt('youth', 'Youth and civic engagement', 'Jeunesse et engagement civique', 'الشباب والمشاركة المدنية'), opt('gender', 'Gender equality', 'Égalité de genre', 'المساواة بين الجنسين'), opt('climate', 'Environment and climate', 'Environnement et climat', 'البيئة والمناخ'), opt('digital', 'Digital skills', 'Compétences numériques', 'المهارات الرقمية'), opt('meal', 'Monitoring and evaluation', 'Suivi et évaluation', 'التتبع والتقييم')] } }),
        f('experience_years', 'number', L('Years of experience', 'Années d’expérience', 'سنوات الخبرة'), { required: true, config: { min: 0, max: 60, step: 1 } }),
        f('daily_rate', 'number', L('Daily rate (MAD)', 'Tarif journalier (MAD)', 'الأجر اليومي (درهم)'), { required: true, config: { min: 0 }, private: true }),
        cv(), f('references', 'long_text', L('Two recent assignments (client, year, topic)', 'Deux missions récentes (client, année, thème)', 'مهمتان حديثتان (الجهة، السنة، الموضوع)'), { required: true, config: { maxLength: 2000 } }),
      ]), consent()],
      rules: [{ id: 'junior', name: 'Less than 3 years', when: { field: 'experience_years', op: 'lt', value: 3 }, then: [{ type: 'eligibility', result: 'needs_review', reason: L('Less than 3 years of experience', 'Moins de 3 ans d’expérience', 'أقل من 3 سنوات خبرة') }] }] } },

  { key: 'organization', name: 'Organisation application', category: 'organization', version: 1, description: 'Partner organisations and associations: identity, registration and focus.',
    definition: { schema: 1, settings: settings(), pages: [
      page('organisation', L('Organisation', 'Organisation', 'الجمعية'), [
        f('org_name', 'short_text', L('Organisation name', 'Nom de l’organisation', 'اسم الجمعية'), { required: true, config: { maxLength: 160 } }),
        f('org_type', 'single_choice', L('Type', 'Type', 'النوع'), { required: true, config: { options: [opt('association', 'Association', 'Association', 'جمعية'), opt('cooperative', 'Cooperative', 'Coopérative', 'تعاونية'), opt('company', 'Company', 'Entreprise', 'مقاولة'), opt('public', 'Public body', 'Organisme public', 'مؤسسة عمومية')] }, appearance: { display: 'dropdown' } }),
        f('founded', 'number', L('Year founded', 'Année de création', 'سنة التأسيس'), { config: { min: 1900, max: 2100, step: 1 }, appearance: { width: 'half' } }),
        f('website', 'url', L('Website or page', 'Site ou page', 'الموقع أو الصفحة'), { appearance: { width: 'half' } }),
        f('focus', 'multi_choice', L('Focus areas', 'Domaines d’action', 'مجالات العمل'), { required: true, config: { options: [opt('youth', 'Youth', 'Jeunesse', 'الشباب'), opt('women', 'Women', 'Femmes', 'النساء'), opt('environment', 'Environment', 'Environnement', 'البيئة'), opt('digital', 'Digital', 'Numérique', 'الرقمي')] } }),
        f('statutes', 'file', L('Statutes or registration certificate (PDF)', 'Statuts ou récépissé (PDF)', 'القانون الأساسي أو وصل التسجيل (PDF)'), { config: { accept: ['pdf'], maxMb: 10, maxFiles: 2 } }),
      ]),
      page('contact', L('Contact person', 'Personne de contact', 'الشخص المسؤول'), [
        f('full_name', 'short_text', L('Full name', 'Nom complet', 'الاسم الكامل'), { required: true, appearance: { width: 'half' } }),
        f('role', 'short_text', L('Role in the organisation', 'Fonction', 'الصفة'), { appearance: { width: 'half' } }),
        f('email', 'email', L('Email', 'E-mail', 'البريد الإلكتروني'), { required: true, appearance: { width: 'half' } }),
        f('phone', 'phone', L('Phone', 'Téléphone', 'الهاتف'), { appearance: { width: 'half' } }),
      ]), consent()],
      rules: [{ id: 'company_review', name: 'Companies are reviewed', when: { field: 'org_type', op: 'equals', value: 'company' }, then: [{ type: 'eligibility', result: 'needs_review', reason: L('Company, not a non-profit', 'Entreprise, pas une structure à but non lucratif', 'مقاولة وليست هيئة غير ربحية') }] }] } },
];
