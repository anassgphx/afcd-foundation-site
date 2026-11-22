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


PILLAR_FILE = {'youth-empowerment': 'youth-empowerment.html', 'women-empowerment': 'womens-empowerment.html',
               'green-thumbs': 'environment-climate.html', 'digital-empowerment': 'digital-inclusion.html'}


def page(name, title, description, active, body, parent=None):
    for slug, f in PILLAR_FILE.items():
        body = body.replace(f'pillars.html#{slug}', f)
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
    ways = [('Volunteer', 'Give time to activities in Ait Ourir and beyond.', 'get-involved.html#volunteer'),
            ('Join a programme', 'Apply when calls open for youth and women’s programmes.', 'get-involved.html#programs'),
            ('Partner with us', 'Co-design and fund community initiatives.', 'get-involved.html#partner')]
    rows = ''.join(f'''<li><a href="{h}" class="cta-way"><span class="cta-way-n">{i:02d}</span><span class="min-w-0 flex-1"><span class="block text-[16px] font-semibold tracking-[-0.015em]">{t}</span><span class="mt-0.5 block text-[13.5px] leading-snug text-ink-mid">{d}</span></span><span class="cta-way-arr" aria-hidden="true">↗</span></a></li>''' for i, (t, d, h) in enumerate(ways, 1))
    return f'''
<section class="cta-wrap py-10 lg:py-14">
  <div class="wrap">
    <div class="cta-card">
      <div class="cta-glow" aria-hidden="true"></div>
      <div class="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-14">
        <div class="lg:col-span-7">
          <span class="cta-kicker"><span class="tb-dot" aria-hidden="true"></span>Get involved</span>
          <h2 class="mt-6 text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] md:text-[56px] lg:text-[64px]" style="text-wrap:balance">{title}</h2>
          <p class="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-ink-dark md:text-[17px]">{text}</p>
          <div class="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a href="{primary[1]}" class="btn-dark btn-cta min-h-[50px] px-7">{primary[0]} {ARR}</a>
            <a href="{secondary[1]}" class="link-arrow">{secondary[0]} {ARR}</a>
          </div>
        </div>
        <ul class="grid gap-2 lg:col-span-5">{rows}</ul>
      </div>
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
PILLAR_INTRO = {
    'youth-empowerment': 'Young people building leadership, civic skills and initiatives that respond to local needs.',
    'women-empowerment': 'Women gaining the confidence, learning and opportunities to take part in community life and decisions.',
    'green-thumbs': 'Communities learning, acting and taking part in dialogue on Morocco’s climate priorities.',
    'digital-empowerment': 'Young people and communities exploring digital skills, AI, science and emerging technologies.',
}
PILLAR_ACTS = {'youth-empowerment': [1, 2, 3, 4], 'women-empowerment': [0, 1, 2, 6],
              'green-thumbs': [3, 4, 2, 0], 'digital-empowerment': [5, 0, 1, 7]}
PILLAR_GROUPS = {'youth-empowerment': [0, 3, 4], 'women-empowerment': [1, 3, 5],
                 'green-thumbs': [0, 5, 6, 4], 'digital-empowerment': [0, 1, 2, 5]}
PILLAR_STEPS = [('Learn', 'Non-formal education and practical training build knowledge and skills.'),
                ('Practise', 'Workshops, mentoring and hands-on activities turn skills into action.'),
                ('Lead', 'Participants design and run their own initiatives in their communities.'),
                ('Share', 'Results, stories and recommendations are shared with partners and decision-makers.')]
PILLAR_SHORT = {'youth-empowerment': 'Youth', 'women-empowerment': 'Women', 'green-thumbs': 'Environment', 'digital-empowerment': 'Digital'}


def pillars():
    # ---- one page per pillar
    for i, (slug, n, t, d, rel) in enumerate(PILLARS):
        tone = PILLAR_TONE[slug]
        objs = [(ref, text, desc) for ref, text, desc, links in OBJECTIVES if any(sl == slug for _n, sl in links)]
        projs = [p for p in PROJECTS if p[1] == slug]
        obj_html = ''.join(f'''
        <li><a href="strategy.html#{ref.lower()}" class="so-card group h-full"><span class="flex items-center justify-between gap-3"><span class="so-ref">{ref}</span><span class="so-n" aria-hidden="true">{ref[-2:]}</span></span><span class="mt-6 block text-[20px] font-semibold leading-[1.2] tracking-[-0.02em]">{text}</span><span class="mt-3 block text-[14.5px] leading-relaxed text-ink-dark">{desc}</span><span class="nw-read">View in strategy <span aria-hidden="true">↗</span></span></a></li>''' for ref, text, desc in objs)
        def pcard(pr):
            name, _sl, _pn, cat, href, summ = pr
            inner = f'''{ph(name, 'aspect-[16/10] w-full rounded-[20px]')}<span class="nw-type">{cat}</span>'''
            body_ = f'''<span class="mt-5 block px-2.5 text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">{name}</span><span class="mt-2 block px-2.5 text-[14.5px] leading-relaxed text-ink-dark">{summ or 'Project details coming soon.'}</span><span class="nw-read px-2.5">{'Explore project' if href else 'Details coming soon'} <span aria-hidden="true">↗</span></span>'''
            if href:
                return f'<li><a href="{href}" class="nw-card group"><div class="relative">{inner}</div>{body_}</a></li>'
            return f'<li><div class="nw-card is-ph"><div class="relative">{inner}</div>{body_}</div></li>'
        proj_html = ''.join(pcard(p) for p in projs)
        for k in range(max(0, 3 - len(projs))):
            proj_html += f'''<li><div class="nw-card is-ph"><div class="relative">{ph('Upcoming project', 'aspect-[16/10] w-full rounded-[20px]', '#E6E6E6')}<span class="nw-type">Placeholder</span></div><span class="mt-5 block px-2.5 text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">Lorem ipsum dolor sit amet</span><span class="mt-2 block px-2.5 text-[14.5px] leading-relaxed text-ink-dark">Consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus.</span><span class="nw-read px-2.5">Coming soon <span aria-hidden="true">↗</span></span></div></li>'''
        acts = ''.join(f'<li class="os-act"><span class="os-act-n">{j:02d}</span><span>{ACTIVITIES[a]}</span></li>' for j, a in enumerate(PILLAR_ACTS[slug], 1))
        groups = ''.join(f'<li class="inline-flex min-h-[38px] items-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium"><span class="pj-dot" style="--c:{tone}"></span>{BENEFICIARIES[g]}</li>' for g in PILLAR_GROUPS[slug])
        steps = ''.join(f'<li class="os-ap"><span class="os-ap-n">{j:02d}</span><span><span class="block text-[18px] font-semibold tracking-[-0.02em]">{a}</span><span class="mt-1 block text-[14px] leading-relaxed text-white/65">{b}</span></span></li>' for j, (a, b) in enumerate(PILLAR_STEPS, 1))
        others = ''.join(f'''<li><a href="{PILLAR_FILE[s2]}" class="pl-other group" style="--c:{PILLAR_TONE[s2]}"><span class="pl-other-n">{n2}</span><span class="mt-8 block text-[22px] font-semibold leading-[1.1] tracking-[-0.03em]">{t2}</span><span class="pj-nav-arr" aria-hidden="true">↗</span></a></li>'''
                         for s2, n2, t2, _d2, _r2 in PILLARS if s2 != slug)
        brand = '<span class="pg-tag">Programme brand: Green Thumbs</span>' if slug == 'green-thumbs' else ''
        body = page_header([('Our Pillars', 'pillars.html'), (t, PILLAR_FILE[slug])], f'Pillar {n} / 04', t, PILLAR_INTRO[slug]) + f'''

<section id="overview" class="pt-8 lg:pt-10">
  <div class="wrap">
    <div class="pl-hero pl-hero-2" style="--c:{tone}">
      <div class="flex flex-col">
        <div class="flex flex-wrap items-center gap-2"><span class="pl-hero-n">Pillar {n}<span class="text-black/40"> / 04</span></span>{brand}</div>
        <p class="mt-5 text-[18px] font-medium leading-[1.4] tracking-[-0.015em] md:text-[24px] md:leading-[1.3]">{d}</p>
        <dl class="pl-stats mt-7">
          <div class="pl-stat"><dt>Projects</dt><dd>{len(projs)}</dd></div>
          <div class="pl-stat"><dt>Objectives</dt><dd class="pl-stat-refs">{''.join(f'<span class="so-ref">{r}</span>' for r, _t, _d in objs)}</dd></div>
        </dl>
        <div class="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-auto lg:pt-8">
          <a href="#projects" class="btn-dark btn-cta min-h-[46px] px-6 text-[14px]">See projects <span class="arr" aria-hidden="true">↓</span></a>
          <a href="#objectives" class="link-arrow">Strategic objectives <span class="arr" aria-hidden="true">↓</span></a>
        </div>
      </div>
      <div class="pl-hero-photo">{ph(t + ' · programme photo', 'h-full w-full rounded-[22px]', '#FFFFFF')}</div>
    </div>
  </div>
</section>

<section id="objectives" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Strategic Objectives', 'What we aim <span class="sh-soft">to achieve.</span>', f'{len(objs)} linked', desc='The institutional objectives this pillar contributes to.')}
    <ul class="mt-8 grid gap-3 md:grid-cols-2 lg:mt-10">{obj_html}
    </ul>
  </div>
</section>

<section id="what-we-do" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / What We Do', 'How this pillar <span class="sh-soft">comes to life.</span>', 'Activities · Participants', desc='The kinds of activities AFCD runs under this pillar, and the people they involve.')}
    <div class="mt-8 grid gap-4 lg:mt-10 lg:grid-cols-12">
      <div class="rounded-[28px] bg-[#F6F6F6] p-6 md:p-8 lg:col-span-7">
        <p class="label text-ink-mid">Core activities</p>
        <ol class="mt-4 grid gap-2 sm:grid-cols-2">{acts}</ol>
      </div>
      <div class="pl-hero lg:col-span-5" style="--c:{tone};padding:28px">
        <p class="label text-black/60">Who we work with</p>
        <ul class="mt-4 flex flex-wrap gap-2">{groups}</ul>
        <p class="mt-6 text-[14px] leading-relaxed text-black/65">Participants and criteria vary by programme.</p>
      </div>
    </div>
  </div>
</section>

<section id="approach" class="py-6 lg:py-8">
  <div class="wrap">
    <div class="os-band on-dark text-white">
      <div class="grid gap-10 lg:grid-cols-12 lg:gap-16">
        <div class="lg:col-span-5">
          <div class="sh-top"><span class="sh-num">03</span><span class="sh-label">Our Approach</span></div>
          <p class="mt-8 text-[34px] font-semibold leading-[1.04] tracking-[-0.045em] md:text-[48px]">From learning <span class="text-white/45">to leading.</span></p>
          <blockquote class="mt-8 rounded-[22px] border border-white/10 bg-white/5 p-6">
            <p class="text-[18px] leading-snug">“Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.”</p>
            <footer class="mt-4 text-[13px] text-white/55">Participant voice · placeholder until a real quote is approved</footer>
          </blockquote>
        </div>
        <ol class="grid content-end gap-3 lg:col-span-7">{steps}</ol>
      </div>
    </div>
  </div>
</section>

<section id="projects" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('04 / Projects', f'Projects in <span class="sh-soft">{PILLAR_SHORT[slug].lower()}.</span>', ('All projects', f'projects.html?pillar={slug}#by-pillar'), desc=f'Programmes AFCD has run under the {t} pillar.')}
    <ul class="nw-grid mt-8 lg:mt-10">{proj_html}
    </ul>
  </div>
</section>

<nav id="other-pillars" class="border-t border-ink-light py-14 lg:py-16" aria-label="Other pillars">
  <div class="wrap">{sec_head('05 / Other Pillars', 'Four pillars, <span class="sh-soft">one shared future.</span>', ('All pillars', 'pillars.html'))}
    <ul class="mt-8 grid gap-3 md:grid-cols-3 lg:mt-10">{others}</ul>
  </div>
</nav>
''' + cta_band('Find your place in our work.', 'Volunteer, join a programme when calls open, or partner with us on this pillar.',
                  ('Get Involved', 'get-involved.html'), ('Partner with us', 'get-involved.html#partner'))
        page(PILLAR_FILE[slug], f'{t} · AFCD Foundation', f'{t}: {d}', 'pillars', body, parent=('Our Pillars', 'pillars.html'))

    # ---- hub
    cards = ''.join(f'''
      <li id="{slug}" class="scroll-mt-32"><a href="{PILLAR_FILE[slug]}" class="pl-card group" style="--c:{PILLAR_TONE[slug]}">
        <span class="flex items-start justify-between"><span class="pl-hero-n">{n}</span><span class="pj-nav-arr" style="position:static" aria-hidden="true">↗</span></span>
        <span class="mt-10 block text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[38px]">{t}</span>
        <span class="mt-4 block text-[15px] leading-relaxed text-black/70">{d}</span>
        <span class="mt-6 flex flex-wrap gap-2">{''.join(f'<span class="pg-tag">{r}</span>' for r in rel)}</span>
      </a></li>''' for slug, n, t, d, rel in PILLARS)
    body = page_header([('Our Pillars', 'pillars.html')], 'Our Pillars',
                       'Four pillars. <span class="text-ink-mid">One shared future.</span>',
                       'Four areas of action shape every AFCD programme, from leadership to the environment and digital inclusion.') + f'''

<section class="py-10 lg:py-14">
  <div class="wrap">
    <ul class="grid gap-3 md:grid-cols-2">{cards}
    </ul>
  </div>
</section>
''' + cta_band('Find your place in our work.', 'Volunteer, join a programme when calls open, or partner with us on a pillar.',
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


PILLAR_TONE = {'youth-empowerment': '#FFB2B9', 'women-empowerment': '#A8DDFB', 'green-thumbs': '#82E591', 'digital-empowerment': '#FBE38A'}


def project_details():
    files = list(DETAILS)
    for idx, (file, d) in enumerate(DETAILS.items()):
        tone = PILLAR_TONE[d['slug']]
        pdesc = next(p[3] for p in PILLARS if p[0] == d['slug'])
        objs = [(ref, text) for ref, text, _desc, links in OBJECTIVES if any(sl == d['slug'] for _n, sl in links)]
        dot = f'<span class="pj-dot" style="--c:{tone}"></span>'
        facts = ''.join(f'<div class="pj-fact"><dt>{k}</dt><dd>{dot if k == "Pillar" else ""}{v}</dd></div>' for k, v in d['facts'])
        n_rows = len(d['rows'])
        steps = ''.join(f'''
        <li class="pj-step{' is-result' if k == 'Results' else ''}">
          <span class="flex items-center justify-between"><span class="pj-step-n">{i:02d}</span><span class="pj-step-k">{k}</span></span>
          <p class="mt-6 text-[17px] leading-[1.55] tracking-[-0.01em] md:text-[18px]">{v}</p>
        </li>''' for i, (k, v) in enumerate(d['rows'], 1))
        obj_html = ''.join(f'<li><a href="strategy.html#{ref.lower()}" class="pj-obj"><span class="so-ref">{ref}</span><span class="flex-1">{text}</span><span aria-hidden="true">↗</span></a></li>' for ref, text in objs)
        prev_f = files[idx - 1]; next_f = files[(idx + 1) % len(files)]
        def nav(f, label):
            o = DETAILS[f]
            return f'''<a href="{f}" class="pj-nav group"><span class="label text-ink-mid">{label}</span><span class="mt-3 flex items-center gap-3"><span class="pj-dot" style="--c:{PILLAR_TONE[o['slug']]}"></span><span class="text-[24px] font-semibold tracking-[-0.03em] md:text-[30px]">{o['name']}</span></span><span class="mt-1 block text-[14px] text-ink-mid">{o['pillar']} · {o['cat']}</span><span class="pj-nav-arr" aria-hidden="true">↗</span></a>'''
        body = page_header([('Projects', 'projects.html'), (d['name'], file)], f'{d["pillar"]} · {d["cat"]}', d['name'], d['lede']) + f'''

<section class="pt-8 lg:pt-10">
  <div class="wrap">
    <div class="pj-hero">
      {ph(d['photo'], 'aspect-[16/10] w-full rounded-[28px] md:aspect-[21/9]')}
      <dl class="pj-facts" style="--f:{len(d['facts'])}">{facts}</dl>
    </div>
  </div>
</section>

<section id="story" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Project Story', 'From context <span class="sh-soft">to results.</span>', f'{n_rows} steps', desc='What the project responded to, how it worked and what it achieved.')}
    <ol class="pj-steps mt-8 lg:mt-10" style="--n:{n_rows}">{steps}
    </ol>
  </div>
</section>

<section id="overview" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-5">
      <div class="sh-top"><span class="sh-num">02</span><span class="sh-label">Overview</span></div>
      <blockquote class="mt-8 text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] md:text-[36px]">“Lorem ipsum dolor sit amet, <span class="text-ink-mid">consectetur adipiscing elit.</span>”</blockquote>
      <p class="mt-4 text-[13px] text-ink-mid">Placeholder text · to be replaced by AFCD</p>
    </div>
    <div class="grid gap-5 text-[16px] leading-[1.75] text-ink-dark lg:col-span-7">
      <p class="text-[20px] leading-[1.5] tracking-[-0.01em] text-ink-pure md:text-[22px]">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet. Donec ullamcorper nulla non metus auctor fringilla.</p>
      <p>Sed posuere consectetur est at lobortis. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum. Maecenas faucibus mollis interdum, nullam quis risus eget urna mollis ornare vel eu leo.</p>
      <p>Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor. Etiam porta sem malesuada magna mollis euismod. Nulla vitae elit libero, a pharetra augue. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh.</p>
      <ul class="mt-2 grid gap-2 sm:grid-cols-2">
        <li class="os-act"><span class="os-act-n">01</span><span>Lorem ipsum dolor sit amet, consectetur.</span></li>
        <li class="os-act"><span class="os-act-n">02</span><span>Vestibulum id ligula porta felis euismod.</span></li>
        <li class="os-act"><span class="os-act-n">03</span><span>Cras mattis consectetur purus sit amet.</span></li>
        <li class="os-act"><span class="os-act-n">04</span><span>Maecenas faucibus mollis interdum nullam.</span></li>
      </ul>
    </div>
  </div>
</section>

<section id="pillar" class="pb-14 lg:pb-16">
  <div class="wrap grid gap-4 lg:grid-cols-12">
    <div class="pj-pillar lg:col-span-7" style="--c:{tone}">
      <p class="label text-black/60">Part of our pillar</p>
      <p class="mt-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[40px]">{d['pillar']}</p>
      <p class="mt-4 max-w-[52ch] text-[15.5px] leading-relaxed text-black/75">{pdesc}</p>
      <a href="pillars.html#{d['slug']}" class="btn-dark btn-cta mt-8 min-h-[46px] px-6 text-[14px]">Explore the pillar <span class="arr" aria-hidden="true">↗</span></a>
    </div>
    <div class="rounded-[28px] border border-ink-light p-6 md:p-8 lg:col-span-5">
      <p class="label text-ink-mid">Strategic objectives</p>
      <ul class="mt-5 grid gap-2">{obj_html}</ul>
    </div>
  </div>
</section>

<section id="gallery" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('03 / Gallery', 'In <span class="sh-soft">pictures.</span>', 'Photos to come')}
    <div class="pj-gallery mt-8 lg:mt-10">
      {ph(d['name'] + ' · gallery', 'pj-g1 w-full rounded-[24px]')}
      {ph(d['name'] + ' · gallery', 'pj-g2 w-full rounded-[24px]')}
      {ph(d['name'] + ' · gallery', 'pj-g3 w-full rounded-[24px]')}
    </div>
  </div>
</section>

<nav class="border-t border-ink-light py-10 lg:py-12" aria-label="More projects">
  <div class="wrap grid gap-3 md:grid-cols-2">{nav(prev_f, 'Previous project')}{nav(next_f, 'Next project')}</div>
</nav>''' + cta_band('Be part of the next edition.', 'Calls for applications, volunteering and partnerships open throughout the year.',
               ('Get Involved', 'get-involved.html'), ('All projects', 'projects.html'))
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


NEWS_PILLAR = {'Youth Empowerment': '#FFB2B9', 'Women’s Empowerment': '#A8DDFB', 'Environment and Climate': '#82E591', 'Digital Inclusion and Innovation': '#FBE38A'}
NEWS_TYPES = {0: 'Call for applications', 1: 'Participant story', 2: 'Participant story'}
# Clearly marked placeholder posts (lorem ipsum) to show the layout until the news feed is connected.
NEWS_PLACEHOLDERS = [
    ('Environment and Climate', 'Programme news', 'Lorem ipsum dolor sit amet, consectetur adipiscing', 'Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec ullamcorper nulla non metus.'),
    ('Digital Inclusion and Innovation', 'Programme news', 'Vestibulum id ligula porta felis euismod semper', 'Cras mattis consectetur purus sit amet fermentum. Maecenas faucibus mollis interdum.'),
    ('Women’s Empowerment', 'Participant story', 'Aenean lacinia bibendum nulla sed consectetur', 'Curabitur blandit tempus porttitor. Etiam porta sem malesuada magna mollis euismod.'),
    ('Youth Empowerment', 'Programme news', 'Nulla vitae elit libero, a pharetra augue', 'Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa.'),
]


def news():
    lead = NEWS[0]
    blog = 'https://afcdfoundation.org/blog/'

    def card(pillar, typ, title, excerpt, photo, date=None, iso=None, placeholder=False):
        meta = f'<time datetime="{iso}">{date}</time>' if date else '<span>Placeholder</span>'
        href = '#' if placeholder else blog
        attrs = ' aria-disabled="true" tabindex="-1"' if placeholder else ''
        return f'''
      <li class="nw-item" data-type="{typ}">
        <a href="{href}" class="nw-card group{' is-ph' if placeholder else ''}"{attrs}>
          <div class="relative">{ph(photo, 'aspect-[16/10] w-full rounded-[20px]')}<span class="nw-type">{typ}</span></div>
          <span class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{NEWS_PILLAR[pillar]}"></span>{pillar}</span><span aria-hidden="true">·</span>{meta}</span>
          <span class="mt-3 block text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">{title}</span>
          <span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{excerpt}</span>
          <span class="nw-read">{'Coming soon' if placeholder else 'Read the story'} <span aria-hidden="true">↗</span></span>
        </a>
      </li>'''

    cards = ''.join(card(n[0], NEWS_TYPES[i], n[3], n[4], n[5], n[2], n[1]) for i, n in enumerate(NEWS) if i > 0)
    cards += ''.join(card(p[0], p[1], p[2], p[3], 'Story photo', placeholder=True) for p in NEWS_PLACEHOLDERS)
    present = [NEWS_TYPES[i] for i in range(1, len(NEWS))] + [p[1] for p in NEWS_PLACEHOLDERS]
    types = ['All stories'] + [t for t in ['Call for applications', 'Participant story', 'Programme news'] if t in present]
    chips = ''.join(f'<button type="button" class="nw-chip" data-news-filter="{"all" if i == 0 else t}" aria-pressed="{"true" if i == 0 else "false"}">{t}</button>' for i, t in enumerate(types))
    topics = ''.join(f'<li><a class="os-area" href="pillars.html#{sl}"><span class="os-area-dot" style="--c:{NEWS_PILLAR[n]}" aria-hidden="true"></span><span class="flex-1">{n}</span><span class="os-area-arr" aria-hidden="true">↗</span></a></li>'
                     for n, sl in [('Youth Empowerment', 'youth-empowerment'), ('Women’s Empowerment', 'women-empowerment'), ('Environment and Climate', 'green-thumbs'), ('Digital Inclusion and Innovation', 'digital-empowerment')])

    body = page_header([('News &amp; Stories', 'news.html')], 'News &amp; Stories',
                       'Stories from <span class="text-ink-mid">our communities.</span>',
                       'News, calls for applications and participant stories from AFCD’s programmes.') + f'''

<section id="featured" class="pt-8 lg:pt-10">
  <div class="wrap">
    <a href="{blog}" class="nw-feat group">
      <div class="relative lg:col-span-7">{ph(lead[5], 'aspect-[16/10] w-full rounded-[24px] lg:aspect-auto lg:h-full lg:min-h-[420px]')}<span class="nw-type">Featured · {NEWS_TYPES[0]}</span></div>
      <div class="flex flex-col p-2 lg:col-span-5 lg:p-6">
        <span class="flex flex-wrap items-center gap-x-3 text-[13px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{NEWS_PILLAR[lead[0]]}"></span>{lead[0]}</span><span aria-hidden="true">·</span><time datetime="{lead[1]}">{lead[2]}</time></span>
        <h2 class="mt-5 text-[30px] font-semibold leading-[1.06] tracking-[-0.04em] md:text-[42px]">{lead[3]}</h2>
        <p class="mt-5 text-[16px] leading-relaxed text-ink-dark">{lead[4]}</p>
        <span class="btn-dark btn-cta mt-8 min-h-[48px] self-start px-6 text-[14px] lg:mt-auto">Read the story <span class="arr" aria-hidden="true">↗</span></span>
      </div>
    </a>
  </div>
</section>

<section id="stories" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / All Stories', 'Latest from <span class="sh-soft">AFCD.</span>', ('Current blog', blog))}
    <div class="nw-chips mt-8" role="group" aria-label="Filter stories">{chips}</div>
    <ul class="nw-grid mt-6" id="news-grid">{cards}
    </ul>
    <p class="nw-empty mt-6 hidden text-[15px] text-ink-mid" role="status">No stories in this category yet.</p>
    {placeholder_note('Real stories open on the current afcdfoundation.org blog. Lorem ipsum cards are placeholders until the news feed is connected.')}
  </div>
</section>

<section id="topics" class="pb-6 lg:pb-8">
  <div class="wrap grid gap-4 lg:grid-cols-12">
    <div class="rounded-[28px] border border-ink-light p-6 md:p-8 lg:col-span-5">
      <p class="label text-ink-mid">Browse by pillar</p>
      <ul class="mt-5 grid gap-2">{topics}</ul>
    </div>
    <div class="os-band on-dark text-white lg:col-span-7">
      <span class="cta-kicker" style="background:#fff;color:#000"><span class="tb-dot" aria-hidden="true"></span>Newsletter</span>
      <p class="mt-6 text-[32px] font-semibold leading-[1.04] tracking-[-0.04em] md:text-[44px]">Never miss <span class="text-white/45">a call for applications.</span></p>
      <p class="mt-4 max-w-[46ch] text-[15.5px] leading-relaxed text-white/65">Programme news, open calls and stories from Ait Ourir and across Morocco, a few times a year.</p>
      <a href="#ft-news-title" class="btn-light btn-cta mt-8 min-h-[48px] px-6 text-[14px]">Subscribe <span class="arr" aria-hidden="true">↓</span></a>
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
SOCIAL_ICO = {'Facebook': '<path d="M9.2 14.5V8.6h2l.3-2.3H9.2V4.8c0-.7.2-1.1 1.1-1.1h1.2V1.6a16 16 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3.1v1.7h-2v2.3h2v5.9h2.5Z" fill="currentColor"/>', 'Instagram': '<rect x="2" y="2" width="12" height="12" rx="3.5" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="8" cy="8" r="2.8" stroke="currentColor" stroke-width="1.4" fill="none"/><circle cx="11.6" cy="4.4" r=".8" fill="currentColor"/>', 'LinkedIn': '<path d="M3.6 6h2.3v7.5H3.6zM4.7 2.4a1.3 1.3 0 1 1 0 2.7 1.3 1.3 0 0 1 0-2.7ZM7.4 6h2.2v1c.3-.6 1.1-1.2 2.3-1.2 2.4 0 2.9 1.6 2.9 3.7v4H12.5V10c0-.9 0-2-1.2-2s-1.4.9-1.4 1.9v3.6H7.4z" fill="currentColor"/>'}
CT_ICON = {'phone': '<path d="M3.2 1.8h2.4l1.2 3-1.6 1a8 8 0 0 0 5 5l1-1.6 3 1.2v2.4a1.4 1.4 0 0 1-1.5 1.4C6.7 13.8 2.2 9.3 1.8 3.3a1.4 1.4 0 0 1 1.4-1.5Z"/>', 'mail': '<rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6"/><path d="m2.5 4.5 5.5 4 5.5-4"/>', 'board': '<path d="M8 1.8 2 4.6v1.2h12V4.6L8 1.8Z"/><path d="M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5M2 13.6h12"/>', 'pin': '<path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8Z"/><circle cx="8" cy="6.5" r="1.6"/>'}


def contact():
    def ico(k):
        return f'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{CT_ICON[k]}</svg>'
    quick = [
        ('phone', 'Call us', '+212 663 618 536', 'tel:+212663618536', 'Call now'),
        ('mail', 'Executive team', 'contact@afcdteam.com', 'mailto:contact@afcdteam.com', 'Write an email'),
        ('board', 'Board leadership', 'akaya@afcdteam.com', 'mailto:akaya@afcdteam.com', 'Write an email'),
        ('pin', 'Main office', 'Marrakech, Morocco', '#office', 'See details'),
    ]
    qcards = ''.join(f'''
      <li><a href="{h}" class="ct-q group"><span class="ct-ico">{ico(k)}</span><span class="mt-6 block text-[12px] font-medium uppercase tracking-[0.16em] text-ink-mid">{l}</span><span class="mt-2 block break-words text-[19px] font-semibold tracking-[-0.02em]">{v}</span><span class="ct-q-act">{a} <span aria-hidden="true">↗</span></span></a></li>''' for k, l, v, h, a in quick)
    topics = ['General question', 'Volunteering', 'Joining a programme', 'Partnership', 'Alumni club', 'Press', 'Board &amp; governance']
    tchips = ''.join(f'<label class="ct-topic"><input type="radio" name="topic" value="{t}"{" checked" if i == 0 else ""}><span>{t}</span></label>' for i, t in enumerate(topics))
    routes = [('Volunteering, programmes &amp; alumni', 'contact@afcdteam.com'), ('Partnerships &amp; press', 'contact@afcdteam.com'), ('Board &amp; governance', 'akaya@afcdteam.com')]
    rhtml = ''.join(f'<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-white/10 py-3.5"><span class="text-[14.5px] text-white/80">{t}</span><a class="text-[14px] font-medium hover:underline" href="mailto:{e}">{e}</a></li>' for t, e in routes)
    socials = ''.join(f'<a class="ft-social" href="{u}" target="_blank" rel="noopener" aria-label="AFCD on {n}"><svg viewBox="0 0 16 16" aria-hidden="true">{SOCIAL_ICO[n]}</svg></a>' for n, u in SOCIALS)
    faqs = [
        ('How do I volunteer with AFCD?', 'Volunteering opportunities are listed on the Get Involved page. You can also send us a message with the topic “Volunteering” and tell us where you are based.', ('Get Involved', 'get-involved.html#volunteer')),
        ('When do calls for applications open?', 'Calls for youth and women’s programmes are announced on News &amp; Stories and in our newsletter. Each call explains who can apply and how.', ('News &amp; Stories', 'news.html')),
        ('How can my organisation partner with AFCD?', 'We co-design and fund community initiatives with international, national and local partners. Choose “Partnership” in the form and tell us about your organisation.', ('Partner with us', 'get-involved.html#partner')),
        ('Where does AFCD work?', 'Our main office is in Marrakech, with roots in Ait Ourir and Al Haouz. Programmes run in selected cities and rural communities across Morocco.', ('Who we work with', 'strategy.html#who-we-serve')),
    ]
    fhtml = ''.join(f'''
      <details class="ct-faq"{" open" if i == 0 else ""}><summary><span>{q}</span><span class="ct-faq-ic" aria-hidden="true">+</span></summary><div class="ct-faq-a"><p>{a}</p><a class="link-arrow mt-4" href="{l[1]}">{l[0]} {ARR}</a></div></details>''' for i, (q, a, l) in enumerate(faqs))

    body = page_header([('Contact', 'contact.html')], 'Contact',
                       'Let’s <span class="text-ink-mid">talk.</span>',
                       'Questions, partnerships, volunteering or press: we’d like to hear from you.') + f'''

<section id="reach" class="pt-8 lg:pt-10">
  <div class="wrap">
    <ul class="ct-quick">{qcards}
    </ul>
  </div>
</section>

<section id="message" class="py-12 lg:py-16">
  <div class="wrap grid gap-4 lg:grid-cols-12">
    <form id="contact-form" class="ct-form lg:col-span-7" novalidate>
      <div class="sh-top"><span class="sh-num">01</span><span class="sh-label">Send a message</span><span class="sh-rule" aria-hidden="true"></span></div>
      <h2 class="mt-6 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[40px]">How can <span class="text-ink-mid">we help?</span></h2>
      <fieldset class="mt-7">
        <legend class="label text-ink-mid">I’m interested in</legend>
        <div class="mt-3 flex flex-wrap gap-2">{tchips}</div>
      </fieldset>
      <div class="mt-6 grid gap-5 sm:grid-cols-2">
        <label class="field"><span>Full name</span><input name="name" type="text" autocomplete="name" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      </div>
      <label class="field mt-5"><span>Organisation <span class="normal-case tracking-normal text-ink-mid">(optional)</span></span><input name="org" type="text" autocomplete="organization"></label>
      <label class="field mt-5"><span>Message</span><textarea name="message" rows="6" required></textarea></label>
      <p class="form-error mt-4 hidden text-sm text-[#B42318]" role="alert">Please fill in your name, a valid email and a message.</p>
      <div class="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-ink-light pt-6">
        <p class="max-w-[38ch] text-[12.5px] leading-relaxed text-ink-mid">This form isn’t connected yet. Nothing is sent. Please email us directly for now.</p>
        <button type="submit" class="btn-dark btn-cta min-h-[50px] px-7">Send message {ARR}</button>
      </div>
    </form>

    <div class="grid content-start gap-4 lg:col-span-5">
      <div id="office" class="os-band on-dark scroll-mt-32 text-white">
        <p class="label text-white/60">Main office</p>
        <p class="mt-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em]">Marrakech, <span class="text-white/45">Morocco.</span></p>
        <p class="mt-3 text-[14.5px] leading-relaxed text-white/65">Roots in Ait Ourir and Al Haouz. Full street address to be confirmed before publication.</p>
        <p class="label mt-8 text-white/60">Who to contact</p>
        <ul class="mt-3 border-b border-white/10">{rhtml}</ul>
        <div class="mt-7 flex items-center gap-2">{socials}</div>
      </div>
      {ph('Map · Marrakech main office', 'aspect-[16/10] w-full rounded-[28px]', '#E5E5E5')}
    </div>
  </div>
</section>

<section id="faq" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap grid gap-10 lg:grid-cols-12 lg:gap-16">
    <div class="lg:col-span-4">{sec_head('02 / Questions', 'Before you <span class="sh-soft">write.</span>', stack=True)}</div>
    <div class="grid gap-2 lg:col-span-8">{fhtml}
    </div>
  </div>
</section>

<section class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap grid gap-4 md:grid-cols-2">
    <div id="privacy" class="scroll-mt-28 rounded-[28px] border border-ink-light p-6 md:p-8"><p class="label text-ink-mid">Privacy Policy</p><p class="mt-4 text-[15px] leading-relaxed text-ink-dark">AFCD Foundation’s privacy policy will be published here.</p>{placeholder_note('Text to be supplied by AFCD.')}</div>
    <div id="accessibility" class="scroll-mt-28 rounded-[28px] border border-ink-light p-6 md:p-8"><p class="label text-ink-mid">Accessibility</p><p class="mt-4 text-[15px] leading-relaxed text-ink-dark">We aim for this website to meet WCAG 2.2 AA. If something doesn’t work for you, please tell us by phone or using the form above.</p></div>
  </div>
</section>'''
    page('contact.html', 'Contact · AFCD Foundation',
         'Contact AFCD Foundation: main office in Marrakech, Morocco. Email contact@afcdteam.com or call +212 663 618 536.', 'contact', body)


if __name__ == '__main__':
    about(); pillars(); projects(); project_details(); news(); partners(); involved(); contact()
    print('pages written to', OUT)
