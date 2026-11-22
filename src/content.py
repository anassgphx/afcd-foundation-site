"""One-off generator for the inner pages in src/pages/.

Run with:  python3 src/content.py
It (re)writes the page sources; build.mjs then wraps them in the shared layout.
Text comes from the homepage and the current afcdfoundation.org site.
Anything AFCD still has to supply is shown as a visible placeholder, never invented.
"""
import os, re
from pathlib import Path

OUT = Path(__file__).parent / 'pages'
ARR = '<span class="arr" aria-hidden="true">↗</span>'

# Official values (AFCD Connect institutional profile)
VALUES = [
    ('I', 'Integrity', 'We act with honesty and uphold strong ethical principles in all our work.'),
    ('II', 'Inclusiveness', 'We respect diversity, promote equal opportunities, and ensure that everyone has a voice.'),
    ('III', 'Transparency', 'We communicate openly and remain accountable for our decisions, actions, and use of resources.'),
    ('IV', 'Effectiveness', 'We focus on practical actions that create meaningful and lasting benefits for communities.'),
]

# Strategic objectives (AFCD Connect). Stable references for reporting and cross-linking.
OBJECTIVES = [
    ('SO-01', 'Strengthen youth leadership and civic participation.',
     'Develop young people’s leadership skills, confidence, and ability to participate in civic life and lead initiatives that respond to community needs.',
     [('Youth Empowerment', 'youth-empowerment')]),
    ('SO-02', 'Advance women’s empowerment and equal opportunities.',
     'Strengthen women’s access to learning, leadership, economic opportunities, and decision-making, and support their meaningful participation in community life.',
     [('Women’s Empowerment', 'women-empowerment')]),
    ('SO-03', 'Promote environmental sustainability and climate action.',
     'Strengthen environmental awareness and support locally led initiatives that protect the environment, encourage sustainable practices, and build community resilience to climate change.',
     [('Environment and Climate', 'green-thumbs')]),
    ('SO-04', 'Expand digital inclusion and innovation.',
     'Improve access to digital knowledge and skills, and support the practical use of artificial intelligence, science, and emerging technologies for learning, problem-solving, and community development.',
     [('Digital Inclusion and Innovation', 'digital-empowerment')]),
    ('SO-05', 'Support entrepreneurship and economic empowerment.',
     'Equip young people and women with entrepreneurial skills, mentoring, and connections to develop viable initiatives and pursue economic opportunities.',
     [('Youth Empowerment', 'youth-empowerment'), ('Women’s Empowerment', 'women-empowerment')]),
    ('SO-06', 'Strengthen civil society capacity and inclusive policy dialogue.',
     'Build civil society organisations’ capacities and enable young people and communities to contribute to consultations, advocacy, and public policy discussions, including climate policy.',
     []),
]
BENEFICIARIES = ['Young people and students', 'Women and young women', 'Children and adolescents',
                 'Aspiring entrepreneurs and community initiative leaders',
                 'Civil society organisations, community associations, and youth workers',
                 'Rural and underserved communities',
                 'Political party representatives and civic actors in climate programmes']
BENEFICIARY_SUMMARY = [
    'AFCD Foundation primarily serves young people and women in Morocco, including students, volunteers, aspiring entrepreneurs, and people leading community initiatives. It supports access to practical learning, mentoring, leadership development, civic participation, and digital and entrepreneurial skills.',
    'Depending on the programme, beneficiaries also include children and adolescents, local civil society organisations, community associations, and youth workers. Climate-related activities also engage political party representatives and other civic actors in learning, consultation, and policy dialogue.',
    'AFCD places emphasis on rural communities and people with limited access to training and participation opportunities. Through participant-led initiatives and work with local organisations, it seeks to extend the benefits of its programmes to the wider community. Age groups and participation criteria vary by programme.',
]
REGIONS = [
    ('Marrakech-Safi', 'Marrakech, Ait Ourir, Al Haouz Province, and surrounding High Atlas communities'),
    ('Oriental', 'Oujda'),
    ('Rabat-Salé-Kénitra', 'Rabat'),
    ('Drâa-Tafilalet', 'Ouarzazate'),
]
COVERAGE_NOTE = 'AFCD works in Morocco through local, regional, and national programmes, with roots in Ait Ourir and Al Haouz and a main office in Marrakech. Activities take place in selected cities and rural communities, while some programmes recruit participants nationally or include online learning. Coverage varies by project; international partnerships and exchanges complement this work.'
AREAS = ['Youth empowerment and civic participation', 'Women’s empowerment',
         'Environment, climate action, and sustainable development', 'Digital inclusion and innovation']
ACTIVITIES = [
    'Non-formal education, skills training, and training of trainers.',
    'Leadership programmes, workshops, bootcamps, and learning events.',
    'Mentoring and coaching for youth-led civic, social, environmental, and entrepreneurial initiatives.',
    'Community outreach, awareness campaigns, and volunteer mobilisation.',
    'Stakeholder consultations, policy dialogue, and preparation of advocacy recommendations.',
    'Digital literacy, artificial intelligence, and practical innovation activities.',
    'Capacity building and peer learning for civil society organisations.',
    'Intercultural learning and international cooperation activities.',
]
SOCIALS = [
    ('Facebook', 'https://www.facebook.com/afcd.foundation'),
    ('Instagram', 'https://www.instagram.com/afcd.foundation'),
    ('LinkedIn', 'https://www.linkedin.com/company/afcd-foundation'),
]

PILLARS = [
    ('youth-empowerment', '01', 'Youth Empowerment',
     'Support young people in building leadership and civic skills, participating in community life, and developing initiatives that respond to local needs.',
     ['Leadership Lab 2.0', 'Youth First Academy', 'Let’s Dialogue']),
    ('women-empowerment', '02', 'Women’s Empowerment',
     'Strengthen women’s capacities, confidence, and access to learning, leadership, and economic opportunities, enabling meaningful participation in community life and decision-making.',
     ['META Skills for Women Empowerment', 'TOT: Gender-based violence']),
    ('green-thumbs', '03', 'Environment and Climate',
     'Promote environmental education, sustainable practices, and community climate action, and connect local perspectives with dialogue on Morocco’s climate priorities and commitments.',
     ['Eco Citizen', 'Oxygen', 'Al Haouz Environmental Film Festival', 'Youth Green Generation']),
    ('digital-empowerment', '04', 'Digital Inclusion and Innovation',
     'Improve access to digital knowledge and skills, and enable young people and communities to explore artificial intelligence, science, and emerging technologies for learning and practical problem-solving.',
     ['SAADA Initiative Project']),
]

# name, pillar slug, pillar name, category, detail page (or None), one-line summary
PROJECTS = [
    ('Leadership Lab 2.0', 'youth-empowerment', 'Youth Empowerment', 'Youth Leadership', 'project-leadership-lab.html',
     'Supporting emerging leaders through entrepreneurship and civic engagement.'),
    ('Youth First Academy', 'youth-empowerment', 'Youth Empowerment', 'Youth Programme', None,
     ''),
    ('Let’s Dialogue', 'youth-empowerment', 'Youth Empowerment', 'Bootcamp', None,
     ''),
    ('META Skills for Women Empowerment', 'women-empowerment', 'Women’s Empowerment', 'Skills Training', None,
     ''),
    ('TOT: Gender-based violence', 'women-empowerment', 'Women’s Empowerment', 'Training of Trainers', None,
     ''),
    ('Eco Citizen', 'green-thumbs', 'Environment and Climate', 'Environment', 'project-eco-citizen.html',
     'Encouraging environmental awareness and community-led action.'),
    ('Oxygen', 'green-thumbs', 'Environment and Climate', 'Environment', None,
     ''),
    ('Al Haouz Environmental Film Festival', 'green-thumbs', 'Environment and Climate', 'Culture & Environment', None,
     ''),
    ('Youth Green Generation', 'green-thumbs', 'Environment and Climate', 'Climate Action', 'project-youth-green-generation.html',
     'Supporting young people in developing responses to climate challenges.'),
    ('SAADA Initiative Project', 'digital-empowerment', 'Digital Inclusion and Innovation', 'Digital Skills', None,
     ''),
]


def page(name, title, description, active, body, parent=None):
    extra = f'parent: {parent[0]}|{parent[1]}\n' if parent else ''
    (OUT / name).write_text(
        f'---\ntitle: {title}\ndescription: {description}\nactive: {active}\n{extra}---\n<span id="top"></span>\n{body.strip()}\n'
    )


HOME_ICO = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.2 8 2.8l5.5 4.4V13a.8.8 0 0 1-.8.8H9.6V10H6.4v3.8H3.3a.8.8 0 0 1-.8-.8V7.2Z"/></svg>'


def page_header(crumbs, label, title, lead, extra='', points=()):
    trail = ''.join(
        f'<li class="phd-sep" aria-hidden="true">/</li><li><a href="{href}">{text}</a></li>'
        for text, href in crumbs[:-1]
    ) + f'<li class="phd-sep" aria-hidden="true">/</li><li aria-current="page" class="phd-cur">{crumbs[-1][0]}</li>'
    return f'''
<section class="page-head phd">
  <div class="phd-glow" aria-hidden="true"></div>
  <div class="wrap relative pb-7 pt-4 lg:pb-9 lg:pt-5">
    <div class="phd-top">
      <nav aria-label="Breadcrumb" class="phd-crumbs">
        <ol><li><a href="index.html" class="phd-home" aria-label="Home">{HOME_ICO}</a></li>{trail}</ol>
      </nav>
      <span class="phd-rule" aria-hidden="true"></span>
      <span class="phd-label"><span class="tb-dot" aria-hidden="true"></span>{label}</span>
    </div>
    <div class="phd-body">
      <h1 class="sh-title sh-xl phd-title">{title}</h1>
      <div class="phd-aside">
        <p class="phd-lead">{lead}</p>
      </div>
    </div>{extra}
  </div>
  <div class="phd-hr" aria-hidden="true"></div>
</section>'''


def points_html(points):
    return ('<ul class="sh-points">' + ''.join(f'<li>{p}</li>' for p in points) + '</ul>') if points else ''


def sec_head(label, title, right='', dark=False, desc='', stack=False):
    """label like '01 / Our Story'. right: plain text (meta) or (text, href) for a pill link."""
    num, _, name = label.partition(' / ')
    if not name:
        num, name = '', label
    if isinstance(right, tuple):
        side = f'<a href="{right[1]}" class="sh-link">{right[0]} {ARR}</a>'
    else:
        side = f'<span class="sh-meta">{right}</span>' if right else ''
    pill = f'<span class="sh-num">{num}</span>' if num else ''
    aside = f'<div class="sh-aside"><span class="brand-line brand-line-thin sh-accent" aria-hidden="true"></span><p class="sh-desc">{desc}</p></div>' if desc else ''
    return f'''
    <header class="sh">
      <div class="sh-top">{pill}<span class="sh-label">{name}</span><span class="sh-rule" aria-hidden="true"></span>{side}</div>
      <div class="sh-body{' sh-stack' if stack else ''}">
        <h2 class="sh-title reveal">{title}</h2>{aside}
      </div>
    </header>'''


def ph(caption, cls='aspect-[4/3] w-full', tone='#D4D4D4', dark=False):
    return f'<div class="ph {"is-dark " if dark else ""}{cls}" style="--ph:{tone}"><span class="ph-cap"><b>Photo</b> · {caption}</span></div>'


def tag(text, dark=False):
    border = 'border-white/25' if dark else 'border-ink-light'
    return f'<span class="label inline-flex rounded-full border {border} px-3 py-1.5">{text}</span>'


def cta_band(title, text, primary, secondary):
    return f'''
<section class="bg-ink-pure text-white on-dark">
  <div class="wrap grid gap-8 py-16 lg:grid-cols-12 lg:items-end lg:py-24">
    <div class="lg:col-span-8">
      <h2 class="h2">{title}</h2>
      <p class="body mt-5 max-w-[52ch] text-white/70">{text}</p>
    </div>
    <div class="flex flex-wrap items-center gap-x-7 gap-y-4 lg:col-span-4 lg:justify-end">
      <a href="{primary[1]}" class="btn-light btn-cta min-h-[50px] px-7">{primary[0]} {ARR}</a>
      <a href="{secondary[1]}" class="link-arrow text-white">{secondary[0]} {ARR}</a>
    </div>
  </div>
</section>'''


def placeholder_note(text, dark=False):
    color = 'border-white/30 text-white/70' if dark else 'border-ink-light text-ink-mid'
    return f'<p class="mt-8 inline-flex items-center gap-2 rounded-full border border-dashed {color} px-4 py-2 text-[12px]">{text}</p>'


# ---------------------------------------------------------------- About
def about():
    impact = [('2,700', 'Alumni of AFCD programs'), ('400', 'Ambassadors across Morocco'),
              ('24', 'Projects completed'), ('<span data-years-since>19</span>', 'Years of community work, since 2007')]
    stats = ''.join(
        f'<div class="border-t border-white/20 py-6 pr-4"><dd class="text-5xl font-semibold tracking-tightest tabular-nums md:text-6xl">{n}</dd><dt class="mt-3 text-sm text-white/65">{t}</dt></div>'
        for n, t in impact)
    # Same coloured value cards as the homepage (single source: src/pages/index.html)
    home = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pages', 'index.html'), encoding='utf-8').read()
    values = re.search(r'<ul class="vl-row[^"]*">(.*?)</ul>', home, re.S).group(1).strip()
    def obj_links(links):
        if not links:
            return '<span class="text-[13px] text-ink-mid">Cross-cutting, all pillars</span>'
        return ''.join(f'<a class="inline-flex min-h-[30px] items-center rounded-full border border-ink-light bg-white px-3 text-[12.5px] font-medium hover:border-ink-pure" href="pillars.html#{slug}">{name}</a>' for name, slug in links)
    objectives = ''.join(f'''
      <li id="{ref.lower()}" class="so-card">
        <span class="flex items-center justify-between gap-3"><span class="so-ref">{ref}</span><span class="so-n" aria-hidden="true">{ref[-2:]}</span></span>
        <span class="mt-6 block text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">{text}</span>
        <span class="mt-3 block text-[14.5px] leading-relaxed text-ink-dark">{desc}</span>
        <span class="mt-auto flex flex-wrap gap-2 pt-6">{obj_links(links)}</span>
      </li>''' for ref, text, desc, links in OBJECTIVES)
    beneficiaries = ''.join(f'<li class="inline-flex min-h-[38px] items-center rounded-full bg-ink-faint px-4 text-[14px] font-medium">{b}</li>' for b in BENEFICIARIES)
    summary = ''.join(f'<p>{p}</p>' for p in BENEFICIARY_SUMMARY)
    regions = ''.join(f'<li class="rounded-2xl border border-white/10 bg-white/5 p-4"><span class="block text-[16px] font-semibold tracking-[-0.015em]">{r}</span><span class="mt-1 block text-[14px] leading-relaxed text-white/65">{c}</span></li>' for r, c in REGIONS)
    team = ''.join(f'''
        <li>
          {ph('Team portrait', 'aspect-[4/5] w-full', '#DADADA')}
          <p class="mt-4 text-lg font-medium tracking-[-0.015em]">Team member</p>
          <p class="text-sm text-ink-mid">Role</p>
        </li>''' for _ in range(4))
    sections = f'''
<section id="story" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Our Story', 'It started with young volunteers <span class="sh-soft">in Ait Ourir.</span>', 'Since 2007', desc='From a group of committed young volunteers in 2007 to programmes across Morocco.')}
    <div class="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-12 lg:gap-16">
      <div class="lg:col-span-6">{ph('Youth First Academy, closing ceremony', 'aspect-[4/3] w-full rounded-3xl')}</div>
      <div class="lg:col-span-5 lg:col-start-8">
        <p class="text-xl leading-[1.45] tracking-[-0.01em] md:text-2xl">Founded in 2007 by a group of committed young volunteers, AFCD Foundation is a Moroccan nonprofit organization dedicated to empowering individuals and strengthening communities.</p>
        <p class="body mt-6 text-ink-dark">Rooted in Ait Ourir and active through initiatives across Morocco, our work focuses on youth and women’s empowerment, environmental education, digital inclusion, and participatory local development.</p>
        <p class="body mt-4 text-ink-dark">We believe sustainable change happens when people, institutions and communities work together to create opportunities and shape their own future.</p>
        <dl class="aura-a mt-10 grid gap-5 rounded-2xl border border-ink-light p-5 text-sm sm:grid-cols-2 md:p-6">
          <div><dt class="label text-ink-mid">Legal name</dt><dd class="mt-1.5 leading-snug">Association le Futur pour les Chantiers et le Développement</dd></div>
          <div><dt class="label text-ink-mid">Main office</dt><dd class="mt-1.5 leading-snug">Marrakech, Morocco · roots in Ait Ourir, Al Haouz</dd></div>
        </dl>
      </div>
    </div>
  </div>
</section>

<section id="mission" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / Mission &amp; Vision', 'What guides <span class="sh-soft">our work.</span>', 'Mission · Vision · Values', desc='A mission we act on every day, a vision we work toward, and four values that shape how we work.')}
    <div class="mt-8 lg:mt-10">
      <div class="grid gap-4 border-t border-ink-light py-8 md:grid-cols-12 md:gap-8 lg:py-10">
        <p class="label text-ink-mid md:col-span-3 md:pt-2">Our Mission</p>
        <p class="text-2xl leading-[1.2] tracking-[-0.025em] md:col-span-9 md:text-[32px]">To promote sustainable development by strengthening the capacities of young people and women through environmental education, economic empowerment, and innovation.</p>
      </div>
      <div class="grid gap-4 border-y border-ink-light py-8 md:grid-cols-12 md:gap-8 lg:py-10">
        <p class="label text-ink-mid md:col-span-3 md:pt-2">Our Vision</p>
        <p class="text-2xl leading-[1.2] tracking-[-0.025em] md:col-span-9 md:text-[32px]">A society free from exploitation and discrimination, where everyone has equal opportunities to grow, contribute, and realise their full potential.</p>
      </div>
      <p class="label mt-14 text-ink-mid">Our Values</p>
      <ul class="vl-row mt-6 grid grid-cols-2 gap-3 lg:flex lg:gap-4">{values}</ul>
    </div>
  </div>
</section>

<section id="approach" class="bg-ink-pure text-white on-dark">
  <div class="wrap py-14 lg:py-16">
    <p class="label text-white/60">03 / Our Approach</p>
    <blockquote class="mt-8 max-w-[18ch] text-[40px] font-semibold leading-[1.02] tracking-tightest sm:text-6xl lg:text-[80px]">With communities, not simply for communities.</blockquote>
    <div class="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/15 bg-white/15 md:grid-cols-3">
      <div class="bg-ink-pure p-6 md:p-8"><p class="label text-white/50">Listen</p><p class="mt-3 text-lg">Start from what communities in Ait Ourir and across Morocco say they need.</p></div>
      <div class="bg-ink-pure p-6 md:p-8"><p class="label text-white/50">Build capacity</p><p class="mt-3 text-lg">Strengthen people’s skills through education, empowerment and innovation.</p></div>
      <div class="bg-ink-pure p-6 md:p-8"><p class="label text-white/50">Act together</p><p class="mt-3 text-lg">Work with residents, institutions and partners so change lasts.</p></div>
    </div>
  </div>
</section>

<section id="strategy" class="scroll-mt-28 border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('04 / Strategy', 'Six strategic <span class="sh-soft">objectives.</span>', 'SO-01 to SO-06', desc='Our institutional objectives guide programme design and reporting. They connect to our four pillars; they are not additional pillars.')}
    <ol class="mt-8 grid gap-3 md:grid-cols-2 lg:mt-10 lg:grid-cols-3">{objectives}</ol>
  </div>
</section>

<section id="who-we-serve" class="scroll-mt-28 border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('05 / Who We Work With', 'People and places <span class="sh-soft">we serve.</span>', 'Across Morocco', desc='Age groups and participation criteria vary by programme; not every activity serves every group.')}
    <div class="mt-8 grid gap-4 lg:mt-10 lg:grid-cols-12">
      <div class="rounded-[28px] border border-ink-light p-6 md:p-8 lg:col-span-7">
        <p class="label text-ink-mid">Primary beneficiary groups</p>
        <ul class="mt-5 flex flex-wrap gap-2">{beneficiaries}</ul>
        <div class="mt-8 grid gap-4 border-t border-ink-light pt-6 text-[15px] leading-relaxed text-ink-dark">{summary}</div>
      </div>
      <div class="grid content-start gap-3 lg:col-span-5">
        <div class="os-band on-dark text-white" style="padding:28px">
          <p class="label text-white/60">Where we work</p>
          <ul class="mt-5 grid gap-3">{regions}</ul>
        </div>
        <div class="rounded-[28px] border border-ink-light p-6 md:p-7"><p class="label text-ink-mid">Coverage</p><p class="mt-3 text-[15px] leading-relaxed text-ink-dark">{COVERAGE_NOTE}</p></div>
      </div>
    </div>
  </div>
</section>

<section id="team" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('06 / Our Team', 'The people who carry <span class="sh-soft">our work forward.</span>', ('Join us', 'get-involved.html'))}
    <ul class="mt-12 grid grid-cols-2 gap-x-5 gap-y-10 lg:mt-16 lg:grid-cols-4">{team}
    </ul>
    {placeholder_note('Team names, roles and portraits to be supplied by AFCD.')}
  </div>
</section>

<section id="impact" class="bg-ink text-white on-dark py-14 lg:py-16">
  <div class="wrap">{sec_head('07 / Our Impact', 'Our impact is <span class="sh-soft">a story of people.</span>', 'Since 2007', dark=True, desc='The measure of this work is the people who carry it on.')}
    <dl class="mt-12 grid grid-cols-2 gap-x-6 lg:mt-16 lg:grid-cols-4">{stats}</dl>
  </div>
</section>
'''

    parts = {m.group(1): m.group(0) for m in re.finditer(r'<section id="([a-z-]+)".*?</section>', sections, re.S)}

    def renum_all(html):
        # number every section heading on a page in order (sh-num pills and the dark "NN / Label" kicker)
        n = iter(range(1, 20))
        return re.sub(r'(<span class="sh-num">)\d\d(</span>)|(<p class="label text-white/60">)\d\d( / )',
                      lambda m: (f'{m.group(1)}{next(n):02d}{m.group(2)}' if m.group(1) else f'{m.group(3)}{next(n):02d}{m.group(4)}'), html)

    cta = cta_band('Let’s create change together.', 'Join our community, explore opportunities or collaborate with AFCD Foundation.',
                   ('Get Involved', 'get-involved.html'), ('Partner With Us', 'get-involved.html#partner'))
    ABOUT = ('About Us', 'about.html')

    def sub(file, crumb, label, title, lead, keys, meta_title, meta_desc):
        first = re.sub(r'\s*<header class="sh">.*?</header>', '', parts[keys[0]], count=1, flags=re.S)  # page header already titles it
        first = first.replace('mt-12 grid', 'grid', 1).replace('<div class="mt-8 lg:mt-10">', '<div>', 1).replace('mt-8 grid', 'grid', 1).replace('mt-12 grid', 'grid', 1)
        body = page_header([ABOUT, (crumb, file)], label, title, lead) + renum_all('\n'.join([first] + [parts[k] for k in keys[1:]])) + cta + about_more(file)
        page(file, meta_title, meta_desc, 'about', body, parent=ABOUT)

    # ---- Our Story: custom layout (story + facts, journey, approach)
    journey = [
        ('2007', 'Founded', 'A group of young people committed to improving living conditions in their community founds AFCD.'),
        ('Roots', 'Ait Ourir &amp; Al Haouz', 'Work rooted in Ait Ourir and the Al Haouz area expands through regional and national initiatives.'),
        ('2020–21', 'Eco-Citizen &amp; Youth First', 'Eco-Citizen, Youth First and Youth First Academy combine environmental awareness, youth mobilisation, leadership and active citizenship.'),
        ('2022 →', 'Leadership Lab', 'Successive editions of Leadership Lab develop this work through training, mentoring, entrepreneurship and support for community initiatives.'),
    ]
    area_tones = ['#FFB2B9', '#A8DDFB', '#82E591', '#FBE38A']
    area_slugs = ['youth-empowerment', 'women-empowerment', 'green-thumbs', 'digital-empowerment']
    areas = ''.join(f'<li><a href="pillars.html#{sl}" class="os-area"><span class="os-area-dot" style="--c:{c}" aria-hidden="true"></span><span class="flex-1">{t}</span><span class="os-area-arr" aria-hidden="true">↗</span></a></li>'
                    for t, c, sl in zip(AREAS, area_tones, area_slugs))
    acts = ''.join(f'<li class="os-act"><span class="os-act-n">{i:02d}</span><span>{t}</span></li>' for i, t in enumerate(ACTIVITIES, 1))
    steps = ''.join(f'''
        <li class="os-step">
          <span class="os-step-k">{k}</span>
          <span class="os-step-dot" aria-hidden="true"></span>
          <span class="mt-5 block text-[20px] font-semibold tracking-[-0.025em]">{t}</span>
          <span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{d}</span>
        </li>''' for k, t, d in journey)
    approach = [('Listen', 'Start from what communities in Ait Ourir and across Morocco say they need.'),
                ('Build capacity', 'Strengthen people’s skills through education, empowerment and innovation.'),
                ('Act together', 'Work with residents, institutions and partners so change lasts.')]
    appr = ''.join(f'''
          <li class="os-ap"><span class="os-ap-n">{i:02d}</span><span><span class="block text-[19px] font-semibold tracking-[-0.02em]">{t}</span><span class="mt-1.5 block text-[14.5px] leading-relaxed text-white/65">{d}</span></span></li>'''
                   for i, (t, d) in enumerate(approach, 1))
    body = page_header([ABOUT, ('Our Story', 'our-story.html')], 'About · Our Story',
                       'It started with young volunteers <span class="text-ink-mid">in Ait Ourir.</span>',
                       'Founded in 2007 by committed young volunteers, AFCD Foundation grew from Ait Ourir into programmes across Morocco.') + f'''

<section id="story" class="py-14 lg:py-20">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-6">
      <p class="text-[26px] font-medium leading-[1.25] tracking-[-0.025em] md:text-[32px]">AFCD Foundation is a Moroccan nonprofit association founded in 2007 that promotes sustainable development through <span class="text-ink-mid">youth and women’s empowerment, environmental education, civic participation, and digital inclusion.</span></p>
      <div class="mt-8 grid gap-5 sm:grid-cols-2">
        <p class="text-[15.5px] leading-relaxed text-ink-dark">Rooted in Ait Ourir and the Al Haouz area, with its main office in Marrakech, AFCD works with young people, women, and local communities across Morocco.</p>
        <p class="text-[15.5px] leading-relaxed text-ink-dark">Through practical training, mentoring, community initiatives, and dialogue, AFCD helps people build skills and contribute to positive change in their communities.</p>
      </div>
      <dl class="os-facts mt-10">
        <div><dt>Founded</dt><dd>2007</dd></div>
        <div><dt>Roots</dt><dd>Ait Ourir, Al Haouz</dd></div>
        <div><dt>Main office</dt><dd>Marrakech</dd></div>
        <div><dt>Pillars</dt><dd>4</dd></div>
      </dl>
    </div>
    <div class="relative lg:col-span-6">
      {ph('Youth First Academy, closing ceremony', 'aspect-[4/3] w-full rounded-[28px] lg:aspect-auto lg:h-full lg:min-h-[460px]')}
      <div class="os-legal">
        <p class="label text-ink-mid">Legal name</p>
        <p class="mt-1.5 text-[15px] font-medium leading-snug">Association le Futur pour les Chantiers et le Développement</p>
      </div>
    </div>
  </div>
</section>

<section id="journey" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Our Journey', 'From Ait Ourir <span class="sh-soft">to across Morocco.</span>', 'Since 2007', desc='How a local volunteer initiative became a national nonprofit.')}
    <ol class="os-steps mt-10 lg:mt-12">{steps}
    </ol>
  </div>
</section>

<section id="what-we-do" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / What We Do', 'Four areas, <span class="sh-soft">eight ways of working.</span>', 'Areas · Activities', desc='Programmes combine non-formal education, practical training, mentoring and community action.')}
    <div class="mt-8 grid gap-4 lg:mt-10 lg:grid-cols-12">
      <div class="rounded-[28px] border border-ink-light p-6 md:p-7 lg:col-span-4">
        <p class="label text-ink-mid">Areas of intervention</p>
        <ul class="mt-4 grid gap-2">{areas}</ul>
      </div>
      <div class="rounded-[28px] bg-[#F6F6F6] p-6 md:p-7 lg:col-span-8">
        <p class="label text-ink-mid">Core activities</p>
        <ol class="mt-4 grid gap-2 sm:grid-cols-2">{acts}</ol>
      </div>
    </div>
  </div>
</section>

<section id="approach" class="py-6 lg:py-8">
  <div class="wrap">
    <div class="os-band on-dark text-white">
      <div class="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div class="lg:col-span-6">
          <div class="sh-top"><span class="sh-num">03</span><span class="sh-label">Our Approach</span></div>
          <blockquote class="mt-8 text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] md:text-[56px]">With communities, <span class="text-white/45">not simply for communities.</span></blockquote>
        </div>
        <ol class="grid content-end gap-3 lg:col-span-6">{appr}
        </ol>
      </div>
    </div>
  </div>
</section>
''' + cta + about_more('our-story.html')
    page('our-story.html', 'Our Story · AFCD Foundation',
         'How young volunteers founded AFCD Foundation in Ait Ourir in 2007, and how we work with communities.',
         'about', body, parent=ABOUT)

    sub('mission-vision.html', 'Mission &amp; Vision', 'About · Mission &amp; Vision',
        'What guides <span class="text-ink-mid">our work.</span>',
        'A mission we act on every day, a vision we work toward, and four values that shape how we work.',
        ['mission'], 'Mission, Vision &amp; Values · AFCD Foundation',
        'AFCD Foundation’s mission, vision and values: integrity, inclusiveness, transparency and effectiveness.')
    sub('strategy.html', 'Strategy &amp; Objectives', 'About · Strategy',
        'Six strategic <span class="text-ink-mid">objectives.</span>',
        'The institutional objectives behind our programmes and reporting, and the people and places we serve.',
        ['strategy', 'who-we-serve'], 'Strategy &amp; Objectives · AFCD Foundation',
        'AFCD Foundation’s six strategic objectives, linked to its four pillars, and who it works with across Morocco.')
    sub('team.html', 'Our Team', 'About · Our Team',
        'The people who carry <span class="text-ink-mid">our work forward.</span>',
        'The team, volunteers and alumni who run AFCD programmes in Marrakech, Al Haouz and across Morocco.',
        ['team'], 'Our Team · AFCD Foundation',
        'Meet the team behind AFCD Foundation’s programmes in Marrakech, Al Haouz and across Morocco.')

    # About hub: overview cards to each sub-page, then impact
    hub = ''.join(f'''
        <li><a href="{f}" class="gi-tile group">
          <span class="flex items-center justify-between"><span class="text-[12px] tabular-nums text-ink-mid">{i:02d}</span><span class="gi-arr" aria-hidden="true">↗</span></span>
          <span class="mt-3 block text-[20px] font-semibold leading-[1.1] tracking-[-0.03em] sm:mt-8 md:text-[24px]">{t}</span>
          <span class="mt-2 block text-[14px] leading-relaxed text-ink-dark">{d}</span>
        </a></li>''' for i, (f, t, d) in enumerate(ABOUT_PAGES, 1))
    body = page_header([ABOUT], 'About Us',
                       'Local roots. <span class="text-ink-mid">Shared purpose.</span> Lasting impact.',
                       'A Moroccan nonprofit association founded in 2007 by young volunteers in Ait Ourir, Al Haouz, with its main office in Marrakech.') + f'''

<section id="explore" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Explore', 'Get to know <span class="sh-soft">AFCD.</span>', 'Since 2007', desc='Our story, what guides us, our strategy and the people behind the work.')}
    <ul class="mt-8 grid gap-3 sm:grid-cols-2 lg:mt-10 lg:grid-cols-4">{hub}
    </ul>
  </div>
</section>
''' + renum_all(parts['impact']).replace('<span class="sh-num">01</span>', '<span class="sh-num">02</span>') + cta
    page('about.html', 'About Us · AFCD Foundation',
         'About AFCD Foundation: a Moroccan nonprofit founded in 2007 in Ait Ourir. Our story, mission and vision, strategy and team.',
         'about', body)


ABOUT_PAGES = [
    ('our-story.html', 'Our Story', 'How young volunteers started AFCD in 2007, and how we work with communities.'),
    ('mission-vision.html', 'Mission &amp; Vision', 'What guides our work and the four values we hold.'),
    ('strategy.html', 'Strategy &amp; Objectives', 'Six objectives behind our programmes, and who we serve.'),
    ('team.html', 'Our Team', 'The people who carry AFCD’s work forward.'),
]


def about_more(current):
    """'More about AFCD' strip at the end of each About sub-page: links to the sibling pages."""
    links = ''.join(
        f'<a href="{f}" class="sh-link">{t} {ARR}</a>' for f, t, _ in ABOUT_PAGES if f != current)
    return f'''
<nav class="border-t border-ink-light py-8" aria-label="More about AFCD">
  <div class="wrap flex flex-wrap items-center gap-3"><span class="label mr-2 text-ink-mid">More about AFCD</span><a href="about.html" class="sh-link">About Us {ARR}</a>{links}</div>
</nav>'''


# ---------------------------------------------------------------- Pillars
def pillars():
    jump = ''.join(
        f'<li><a href="#{slug}" class="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-ink-light bg-white px-4 text-[13px] font-medium hover:border-ink-pure"><span class="text-[10px] tabular-nums text-ink-mid">{n}</span>{t}</a></li>'
        for slug, n, t, _, _ in PILLARS)
    sections = ''
    for i, (slug, n, t, d, rel) in enumerate(PILLARS):
        flip = i % 2 == 1
        rel_items = ''.join(f'<li class="flex items-center justify-between gap-4 border-t border-ink-light py-3.5 text-[15px]"><span>{r}</span><span class="text-ink-mid" aria-hidden="true">↗</span></li>' for r in rel)
        sections += f'''
<section id="{slug}" class="scroll-mt-28 py-14 lg:py-16">
  <div class="wrap grid gap-12 lg:grid-cols-12 lg:items-center lg:gap-16">
    <div class="lg:col-span-6 {'lg:order-2 lg:col-start-7' if flip else ''}">{ph(t + ' · programme photo', 'aspect-[5/4] w-full rounded-3xl')}</div>
    <div class="lg:col-span-5 {'lg:order-1' if flip else 'lg:col-start-8'}">
      <p class="label text-ink-mid">Pillar {n} / 04</p>
      <h2 class="mt-5 text-[40px] font-semibold leading-[1.02] tracking-tightest md:text-[56px]">{t}</h2>
      <p class="body mt-6 text-ink-dark">{d}</p>{'<p class="mt-3 text-[13px] text-ink-mid">Programme brand: Green Thumbs</p>' if slug == 'green-thumbs' else ''}
      <p class="label mt-10 text-ink-mid">Related projects</p>
      <ul class="mt-3 border-b border-ink-light">{rel_items}</ul>
      <a href="projects.html?pillar={slug}#by-pillar" class="btn-dark btn-cta mt-8">See {t} projects {ARR}</a>
    </div>
  </div>
</section>'''
    body = page_header([('Our Pillars', 'pillars.html')], 'Our Pillars',
                       'Four pillars. <span class="text-ink-mid">One shared future.</span>',
                       'Four areas of action shape every AFCD programme, from leadership to the environment and digital inclusion.',
                       f'\n    <ul class="mt-10 flex flex-wrap gap-2" aria-label="Jump to a pillar">{jump}</ul>',
                       points=('Youth', 'Women', 'Environment', 'Digital')) + sections + cta_band(
        'Find your place in our work.', 'Volunteer, join a programme when calls open, or partner with us on a pillar.',
        ('Get Involved', 'get-involved.html'), ('All projects', 'projects.html'))
    page('pillars.html', 'Our Pillars · AFCD Foundation',
         'Youth Empowerment, Women’s Empowerment, Environment and Climate and Digital Inclusion and Innovation: the four pillars of AFCD Foundation’s work.',
         'pillars', body)


# ---------------------------------------------------------------- Projects
def project_card(p, featured=False):
    name, slug, pname, cat, href, summary = p
    inner = f'''
        {ph(name, 'aspect-[4/3] w-full', '#D4D4D4')}
        <div class="mt-5 flex flex-wrap items-center gap-2">{tag(pname)}<span class="label text-ink-mid">{cat}</span></div>
        <h3 class="mt-4 text-2xl font-semibold leading-[1.15] tracking-[-0.03em]">{name}</h3>
'''
    if summary:
        inner += f'\n        <p class="mt-2 text-[15px] leading-relaxed text-ink-dark">{summary}</p>'
    if href:
        inner += f'\n        <span class="link-arrow mt-5">Explore project {ARR}</span>'
        return f'<li data-pillar="{slug}" class="proj-card"><a href="{href}" class="group block">{inner}\n      </a></li>'
    return f'<li data-pillar="{slug}" class="proj-card">{inner}\n        <span class="mt-5 inline-block text-[13px] text-ink-mid">Project page coming soon</span>\n      </li>'


def projects():
    featured = [p for p in PROJECTS if p[4]]
    feat_cards = ''.join(project_card(p) for p in featured)
    filters = '<li><button type="button" class="proj-filter is-on" data-filter="all" aria-pressed="true">All</button></li>' + ''.join(
        f'<li><button type="button" class="proj-filter" data-filter="{slug}" aria-pressed="false">{t}</button></li>'
        for slug, _, t, _, _ in PILLARS)
    all_cards = ''.join(project_card(p) for p in PROJECTS)
    body = page_header([('Projects', 'projects.html')], 'Projects',
                       'Our work <span class="text-ink-mid">in action.</span>',
                       'How shared ideas become community initiatives, across our four pillars.', points=('<b>10</b> Projects listed', '<b>3</b> Case studies')) + f'''

<section id="featured" class="scroll-mt-28 py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Featured Projects', 'Selected <span class="sh-soft">case studies.</span>', desc='Three projects told in depth: the context, our approach, the activities and the results.')}
    <ul class="mt-12 grid gap-x-6 gap-y-12 md:grid-cols-3 lg:mt-16">{feat_cards}</ul>
  </div>
</section>

<section id="by-pillar" class="scroll-mt-28 py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / Projects by Pillar', 'Browse by <span class="sh-soft">area of action.</span>', ('Our pillars', 'pillars.html'), desc='Filter AFCD projects by the pillar they belong to.')}
    <ul class="mt-10 flex flex-wrap gap-2" aria-label="Filter projects by pillar">{filters}</ul>
    <ul id="proj-grid" class="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">{all_cards}</ul>
    <p id="proj-empty" class="mt-10 hidden text-ink-mid">No projects under this pillar yet.</p>
    {placeholder_note('The current site lists 15 projects. The rest will be added from AFCD’s archive.')}
  </div>
</section>
''' + cta_band('Have an idea for your community?', 'We co-design and fund community initiatives with partners and local residents.',
               ('Partner With Us', 'get-involved.html#partner'), ('Contact us', 'contact.html'))
    page('projects.html', 'Projects · AFCD Foundation',
         'AFCD Foundation projects across youth and women’s empowerment, the environment and digital inclusion.',
         'projects', body)


# ---------------------------------------------------------------- Project detail pages
DETAILS = {
    'project-leadership-lab.html': dict(
        name='Leadership Lab 2.0', pillar='Youth Empowerment', slug='youth-empowerment', cat='Youth Leadership',
        lede='Supporting emerging leaders through entrepreneurship and civic engagement.',
        facts=[('Pillar', 'Youth Empowerment'), ('Category', 'Youth Leadership'), ('Format', 'Year-long training')],
        rows=[('Context', 'A large youth population in Morocco is turning to entrepreneurship, and attitudes toward innovation and risk-taking are shifting.'),
              ('Approach', 'Adapts practices from the U.S. entrepreneurial system and principles of participatory democracy.'),
              ('Activities', 'Year-long civic engagement and entrepreneurship training tracks for selected young people.'),
              ('Results', 'Participant stories shared on the AFCD blog (2023).')],
        photo='Leadership Lab 2.0 · project photo', next_='project-eco-citizen.html', next_name='Eco Citizen'),
    'project-eco-citizen.html': dict(
        name='Eco Citizen', pillar='Environment and Climate', slug='green-thumbs', cat='Environment',
        lede='Encouraging environmental awareness and community-led action.',
        facts=[('Pillar', 'Environment and Climate'), ('Category', 'Environment'), ('Location', 'Ait Ourir'), ('Years', '2020 – 2021')],
        rows=[('Context', 'Residents and decision-makers in Ait Ourir describe household waste management as a persistent problem.'),
              ('Approach', 'A participatory process bringing residents, local NGOs and elected representatives together.'),
              ('Activities', 'Awareness campaigns (2020), then workshops on waste sorting and recycling and training for new local committees (2021).'),
              ('Results', 'Alternative waste-management proposals developed with the community.')],
        photo='Eco Citizen · Ait Ourir 2021', next_='project-youth-green-generation.html', next_name='Youth Green Generation'),
    'project-youth-green-generation.html': dict(
        name='Youth Green Generation', pillar='Environment and Climate', slug='green-thumbs', cat='Climate Action',
        lede='Supporting young people in developing responses to climate challenges.',
        facts=[('Pillar', 'Environment and Climate'), ('Category', 'Climate Action'), ('Cohort', '2024')],
        rows=[('Context', 'Builds on AFCD’s earlier climate projects, locally and nationally (blog, November 2023).'),
              ('Approach', 'Empowering young people to take the lead on climate action in their communities.'),
              ('Activities', 'Call for applications for the 2024 cohort.')],
        photo='Youth Green Generation · 2024 call', next_='project-leadership-lab.html', next_name='Leadership Lab 2.0'),
}


def project_details():
    for file, d in DETAILS.items():
        facts = ''.join(f'<div class="flex items-baseline justify-between gap-4 border-t border-ink-light py-3.5"><dt class="label text-ink-mid">{k}</dt><dd class="text-right text-[15px] font-medium">{v}</dd></div>' for k, v in d['facts'])
        rows = ''.join(f'''
        <div class="grid gap-3 border-t border-ink-light py-8 md:grid-cols-12 md:gap-8">
          <h2 class="label pt-1 text-ink-mid md:col-span-3">{k}</h2>
          <p class="text-xl leading-[1.5] tracking-[-0.01em] md:col-span-9">{v}</p>
        </div>''' for k, v in d['rows'])
        gallery = ''.join(f'<div>{ph(d["name"] + " · gallery", "aspect-[4/3] w-full")}</div>' for _ in range(3))
        body = page_header([('Projects', 'projects.html'), (d['name'], file)], f'{d["pillar"]} · {d["cat"]}', d['name'], d['lede'], points=(d['pillar'], d['cat'])) + f'''

<section class="pt-12 lg:pt-16">
  <div class="wrap">{ph(d['photo'], 'aspect-[16/9] w-full rounded-3xl md:aspect-[21/9]')}</div>
</section>

<section class="py-14 lg:py-16">
  <div class="wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
    <aside class="lg:col-span-4">
      <div class="lg:sticky lg:top-28">
        <p class="label">At a glance</p>
        <dl class="mt-5 border-b border-ink-light">{facts}</dl>
        <a href="pillars.html#{d['slug']}" class="link-arrow mt-6">About {d['pillar']} {ARR}</a>
      </div>
    </aside>
    <div class="min-w-0 lg:col-span-8">{rows}
      <div class="border-t border-ink-light pt-10">
        <p class="label text-ink-mid">Gallery</p>
        <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">{gallery}</div>
      </div>
    </div>
  </div>
</section>

<section class="border-t border-ink-light">
  <a href="{d['next_']}" class="group wrap flex items-center justify-between gap-6 py-12 lg:py-16">
    <span><span class="label block text-ink-mid">Next project</span><span class="mt-3 block text-3xl font-semibold tracking-[-0.035em] group-hover:underline md:text-5xl">{d['next_name']}</span></span>
    <span class="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-ink-light text-xl transition-colors group-hover:border-ink-pure group-hover:bg-ink-pure group-hover:text-white" aria-hidden="true">→</span>
  </a>
</section>'''
        page(file, f'{d["name"]} · AFCD Foundation', f'{d["name"]}: {d["lede"]}', 'projects', body)


# ---------------------------------------------------------------- News
NEWS = [
    ('Youth Empowerment', '2023-11-02', 'November 2, 2023', 'Solutions to Climate Change: The Youth Green Generation Project 2024',
     'AFCD has spent recent years on projects that address climate change locally and nationally. This post introduces the Youth Green Generation project and its call for young applicants.', 'call-for-application'),
    ('Youth Empowerment', '2023-10-01', 'October 1, 2023', 'A Journey of a Thousand Miles Begins with a Single Step',
     'A participant’s account of joining a one-year AFCD program on the last day of registration.', 'DSC04067'),
    ('Women’s Empowerment', '2023-10-01', 'October 1, 2023', 'Journey with the AFCD Family',
     'A Leadership Lab participant on a year of networking, capacity building and social entrepreneurship.', 'DSC03718'),
]


def news():
    lead = NEWS[0]
    rest = ''.join(f'''
      <li>
        <a href="https://afcdfoundation.org/blog/" class="group grid gap-5 border-t border-ink-light py-8 sm:grid-cols-[220px_1fr] sm:gap-8">
          {ph(n[5], 'aspect-[4/3] w-full')}
          <span class="min-w-0">
            <span class="flex flex-wrap items-center gap-3 text-xs"><span class="label">{n[0]}</span><time class="text-ink-mid" datetime="{n[1]}">{n[2]}</time></span>
            <span class="mt-3 block text-2xl font-semibold leading-[1.2] tracking-[-0.025em] group-hover:underline">{n[3]}</span>
            <span class="mt-2 block text-[15px] leading-relaxed text-ink-dark">{n[4]}</span>
            <span class="link-arrow mt-4">Read on the current site {ARR}</span>
          </span>
        </a>
      </li>''' for n in NEWS[1:])
    body = page_header([('News &amp; Stories', 'news.html')], 'News &amp; Stories',
                       'Stories from <span class="text-ink-mid">our communities.</span>',
                       'News, calls for applications and participant stories from AFCD’s programmes.', points=('Programme news', 'Calls for applications', 'Stories')) + f'''

<section class="py-14 lg:py-16">
  <div class="wrap">
    <a href="https://afcdfoundation.org/blog/" class="group grid gap-8 lg:grid-cols-12 lg:items-center lg:gap-16">
      <div class="lg:col-span-7">{ph(lead[5], 'aspect-[16/10] w-full rounded-3xl')}</div>
      <div class="lg:col-span-5">
        <p class="label text-ink-mid">Latest story</p>
        <div class="mt-5 flex flex-wrap items-center gap-3 text-xs">{tag(lead[0])}<time class="text-ink-mid" datetime="{lead[1]}">{lead[2]}</time></div>
        <h2 class="mt-5 text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] group-hover:underline md:text-[44px]">{lead[3]}</h2>
        <p class="body mt-5 text-ink-dark">{lead[4]}</p>
        <span class="link-arrow mt-6">Read on the current site {ARR}</span>
      </div>
    </a>
    <div class="mt-20">{sec_head('More stories', 'From <span class="sh-soft">the archive.</span>', ('Current blog', 'https://afcdfoundation.org/blog/'))}
      <ul class="mt-10 border-b border-ink-light">{rest}
      </ul>
      {placeholder_note('Stories open on the current afcdfoundation.org blog until the news feed is connected.')}
    </div>
  </div>
</section>
''' + cta_band('Have a story to share?', 'Alumni, volunteers and partners: tell us about the change you’ve seen.',
               ('Contact us', 'contact.html'), ('Get Involved', 'get-involved.html'))
    page('news.html', 'News & Stories · AFCD Foundation',
         'News, calls for applications and participant stories from AFCD Foundation.', 'news', body)


# ---------------------------------------------------------------- Partners
def partners():
    body = page_header([('Partners', 'partners.html')], 'Our Partners',
                       'Stronger <span class="text-ink-mid">together.</span>',
                       'International, national and local organizations that have supported AFCD’s programmes, as listed on the current Our Partners page.', points=('<b>18</b> Partners', 'International', 'National', 'Local')) + f'''

<section class="py-14 lg:py-16">
  <div class="wrap">
    <div id="partner-groups"></div>
    {placeholder_note('Logos to be added. AFCD will confirm which partnerships are current.')}
  </div>
</section>

<section class="py-14 lg:py-16">
  <div class="wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-5">{sec_head('Partner with AFCD', 'Co-design <span class="sh-soft">change with us.</span>', stack=True)}</div>
    <ul class="grid gap-3 sm:grid-cols-3 lg:col-span-7 lg:self-end">
      <li class="rounded-2xl border border-ink-light p-6"><p class="label text-ink-mid">Fund</p><p class="mt-3 text-lg">Support a programme under one of our four pillars.</p></li>
      <li class="rounded-2xl border border-ink-light p-6"><p class="label text-ink-mid">Co-design</p><p class="mt-3 text-lg">Build an initiative with us and the community.</p></li>
      <li class="rounded-2xl border border-ink-light p-6"><p class="label text-ink-mid">Share expertise</p><p class="mt-3 text-lg">Train, mentor or host our participants.</p></li>
    </ul>
  </div>
</section>
''' + cta_band('Let’s build something together.', 'Tell us about your organization and what you would like to support.',
               ('Partner With Us', 'contact.html'), ('Our projects', 'projects.html'))
    page('partners.html', 'Partners · AFCD Foundation',
         'The international, national and local organizations that have supported AFCD Foundation’s programmes.', 'partners', body)


# ---------------------------------------------------------------- Get Involved
def involved():
    ways = [
        ('volunteer', '01', 'Volunteer', 'Give time to activities in Ait Ourir and beyond.',
         ['Help run workshops and community days', 'Support events and campaigns', 'Bring your skills to a programme'], 'Become a volunteer'),
        ('programs', '02', 'Join a Programme', 'Apply when calls open for youth and women’s programmes.',
         ['Leadership and entrepreneurship tracks', 'Environmental and climate projects', 'Digital skills workshops'], 'Ask about open calls'),
        ('partner', '03', 'Partner With Us', 'Co-design and fund community initiatives.',
         ['Fund a programme or a pillar', 'Co-design an initiative', 'Share expertise and mentoring'], 'Start a partnership'),
        ('alumni', '04', 'Alumni Club', 'Stay connected with the 2,700 alumni of AFCD programmes.',
         ['Meet fellow alumni', 'Mentor new participants', 'Hear about new opportunities first'], 'Join the alumni club'),
    ]
    cards = ''.join(f'''
    <li id="{sid}" class="scroll-mt-28 flex flex-col rounded-3xl border border-ink-light bg-white p-6 md:p-8">
      <div class="flex items-center justify-between"><span class="text-[11px] tabular-nums text-ink-mid">{n}</span><span class="brand-line brand-line-thin block w-10 rounded-full" aria-hidden="true"></span></div>
      <h2 class="mt-8 text-[32px] font-semibold leading-[1.05] tracking-[-0.035em]">{t}</h2>
      <p class="mt-3 text-[15px] leading-relaxed text-ink-dark">{d}</p>
      <ul class="mt-6 border-b border-ink-light text-[15px]">{''.join(f'<li class="border-t border-ink-light py-3">{b}</li>' for b in bullets)}</ul>
      <a href="contact.html" class="btn-dark btn-cta mt-8 self-start">{cta} {ARR}</a>
    </li>''' for sid, n, t, d, bullets, cta in ways)
    body = page_header([('Get Involved', 'get-involved.html')], 'Get Involved',
                       'Let’s create change <span class="text-ink-mid">together.</span>',
                       'Join our community, explore opportunities or collaborate with AFCD Foundation to create meaningful and lasting impact.', points=('Volunteer', 'Programmes', 'Partner', 'Alumni')) + f'''

<section class="py-14 lg:py-16">
  <div class="wrap">
    <ul class="grid gap-4 md:grid-cols-2">{cards}
    </ul>
  </div>
</section>
''' + cta_band('Not sure where you fit?', 'Write to us and we’ll find the right way for you to take part.',
               ('Contact us', 'contact.html'), ('About AFCD', 'about.html'))
    page('get-involved.html', 'Get Involved · AFCD Foundation',
         'Volunteer, join a programme, partner with us or join the alumni club at AFCD Foundation.', 'involved', body)


# ---------------------------------------------------------------- Contact
def contact():
    body = page_header([('Contact', 'contact.html')], 'Contact',
                       'Let’s <span class="text-ink-mid">talk.</span>',
                       'Questions, partnerships, volunteering or press: we’d like to hear from you.', points=('Marrakech', 'contact@afcdteam.com')) + f'''

<section class="py-14 lg:py-16">
  <div class="wrap grid gap-12 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-5">
      <p class="label">Visit or call</p>
      <dl class="mt-5 border-b border-ink-light text-[15px]">
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Main office</dt><dd>Marrakech, Morocco<br><span class="text-ink-mid">Full street address to be confirmed before publication</span></dd></div>
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Roots</dt><dd>Ait Ourir, Al Haouz</dd></div>
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Phone</dt><dd class="tabular-nums"><a class="hover:underline" href="tel:+212663618536">+212 663 618 536</a></dd></div>
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Executive team</dt><dd><a class="hover:underline" href="mailto:contact@afcdteam.com">contact@afcdteam.com</a></dd></div>
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Board leadership</dt><dd><a class="hover:underline" href="mailto:akaya@afcdteam.com">akaya@afcdteam.com</a></dd></div>
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Follow</dt><dd class="flex flex-wrap gap-2">{''.join(f'<a class="sh-link" href="{u}" target="_blank" rel="noopener">{n} {ARR}</a>' for n, u in SOCIALS)}</dd></div>
      </dl>
      {ph('Map · Marrakech main office', 'mt-8 aspect-[4/3] w-full rounded-3xl', '#E5E5E5')}
    </div>

    <div class="lg:col-span-6 lg:col-start-7">
      <form id="contact-form" class="aura-a rounded-3xl border border-ink-light p-6 md:p-8" novalidate>
        <p class="label">Send a message</p>
        <div class="mt-6 grid gap-5 sm:grid-cols-2">
          <label class="field"><span>Full name</span><input name="name" type="text" autocomplete="name" required></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
        </div>
        <label class="field mt-5"><span>I’m interested in</span>
          <select name="topic">
            <option>General question</option><option>Volunteering</option><option>Joining a programme</option><option>Partnership</option><option>Alumni club</option><option>Press</option>
          </select>
        </label>
        <label class="field mt-5"><span>Message</span><textarea name="message" rows="6" required></textarea></label>
        <p class="form-error mt-4 hidden text-sm text-[#B42318]" role="alert">Please fill in your name, a valid email and a message.</p>
        <div class="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p class="text-[12px] text-ink-mid">This form isn’t connected yet. Nothing is sent.</p>
          <button type="submit" class="btn-dark btn-cta min-h-[50px] px-7">Send message {ARR}</button>
        </div>
      </form>
    </div>
  </div>
</section>

<section class="border-t border-ink-light py-16 lg:py-20">
  <div class="wrap grid gap-10 md:grid-cols-2">
    <div id="privacy" class="scroll-mt-28"><p class="label">Privacy Policy</p><p class="mt-4 text-[15px] leading-relaxed text-ink-dark">AFCD Foundation’s privacy policy will be published here.</p>{placeholder_note('Text to be supplied by AFCD.')}</div>
    <div id="accessibility" class="scroll-mt-28"><p class="label">Accessibility</p><p class="mt-4 text-[15px] leading-relaxed text-ink-dark">We aim for this website to meet WCAG 2.2 AA. If something doesn’t work for you, please tell us by phone or using the form above.</p></div>
  </div>
</section>'''
    page('contact.html', 'Contact · AFCD Foundation',
         'Contact AFCD Foundation: main office in Marrakech, Morocco. Email contact@afcdteam.com or call +212 663 618 536.', 'contact', body)


if __name__ == '__main__':
    about(); pillars(); projects(); project_details(); news(); partners(); involved(); contact()
    print('pages written to', OUT)
