"""One-off generator for the inner pages in src/pages/.

Run with:  python3 src/content.py
It (re)writes the page sources; build.mjs then wraps them in the shared layout.
Text comes from the homepage and the current afcdfoundation.org site.
Anything AFCD still has to supply is shown as a visible placeholder, never invented.
"""
import os, re
from pathlib import Path

OUT = Path(os.environ.get('STUDIO_OUT') or Path(__file__).parent / 'pages')
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
# Project data lives in src/data/projects.json (managed by AFCD Studio). STUDIO_PROJECTS_JSON can point elsewhere for previews.
import json as _json
_PROJECTS_FILE = Path(os.environ.get('STUDIO_PROJECTS_JSON') or Path(__file__).parent / 'data' / 'projects.json')
_PROJECT_DATA = _json.loads(_PROJECTS_FILE.read_text(encoding='utf-8'))['projects']
_PILLAR_NAMES = {'youth-empowerment': 'Youth Empowerment', 'women-empowerment': 'Women’s Empowerment',
                 'green-thumbs': 'Environment and Climate', 'digital-empowerment': 'Digital Inclusion and Innovation'}
from html import escape as _esc
# keep the file order unless Studio gives an explicit sort value
_PROJECT_DATA = [p for _i, p in sorted(enumerate(_PROJECT_DATA), key=lambda ip: (ip[1].get('sort', (ip[0] + 1) * 10), ip[0]))]
PROJECTS = [(p['name'], p['pillar'], _PILLAR_NAMES[p['pillar']], p['category'], p['file'] if p.get('detail') else None, p.get('summary') or '')
            for p in _PROJECT_DATA]
# every pillar a project is linked to (primary first); Studio exports "pillars", older data only has "pillar"
PROJECT_PILLARS = {p['name']: (p.get('pillars') or [p['pillar']]) for p in _PROJECT_DATA}


def media_img(m, cls, sizes='100vw', eager=False):
    """Responsive <img> for a Studio media item ({src, srcset, w, h, alt}). Falls back to a placeholder if missing."""
    if not m:
        return ''
    load = 'eager" fetchpriority="high' if eager else 'lazy'
    return (f'<img src="{m["src"]}" srcset="{m["srcset"]}" sizes="{sizes}" width="{m["w"]}" height="{m["h"]}" '
            f'alt="{_esc(m.get("alt") or "")}" loading="{load}" decoding="async" class="{cls} object-cover" '
            f'style="object-position:{m.get("fx", 50)}% {m.get("fy", 50)}%">')



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
ACT_ICONS = ['<path d="M2.5 6 10 3l7.5 3L10 9 2.5 6Z"/><path d="M5.5 7.3v4c0 1.2 2 2.2 4.5 2.2s4.5-1 4.5-2.2v-4"/>', '<path d="M10 2.5v3M4.7 4.7l2.1 2.1M15.3 4.7l-2.1 2.1"/><circle cx="10" cy="11.5" r="4"/><path d="M8.5 17.5h3"/>', '<circle cx="7" cy="6.5" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M2.5 16c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3M11.5 13.2c.6-.5 1.3-.7 2-.7 1.8 0 3.2 1.3 3.7 3.5"/>', '<path d="M3 8.5v3l9 3.5V5L3 8.5Z"/><path d="M12 7h2.5a2 2 0 0 1 0 4H12M5.5 12.5 6.5 16"/>', '<path d="M3.5 4.5h13v8h-7l-4 3v-3h-2v-8Z"/><path d="M7 8.5h6"/>', '<rect x="3" y="4" width="14" height="9.5" rx="1.5"/><path d="M7.5 16.5h5M10 13.5v3M7.5 8.7l1.7 1.6 3.3-3.3"/>', '<path d="M10 2.5 3 6v1.5h14V6L10 2.5Z"/><path d="M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M2.5 16.5h15"/>', '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3Z"/>']
PILLAR_STEPS = [('Learn', 'Non-formal education and practical training build knowledge and skills.'),
                ('Practise', 'Workshops, mentoring and hands-on activities turn skills into action.'),
                ('Lead', 'Participants design and run their own initiatives in their communities.'),
                ('Share', 'Results, stories and recommendations are shared with partners and decision-makers.')]
PILLAR_APPROACH = {
    'youth-empowerment': dict(
        title='From learning <span class="text-white/45">to leading.</span>',
        view='We see young people as actors of change, not only participants. Our role is to build their leadership and civic skills, then step back so they can shape initiatives that answer their own communities’ needs.',
        principles=['Youth-led', 'Civic participation', 'Rooted locally'],
        steps=[('Learn', 'Leadership and civic skills through non-formal education and practical training.'),
               ('Practise', 'Workshops, bootcamps and mentoring turn new skills into confidence.'),
               ('Lead', 'Participants design and run their own initiatives responding to local needs.'),
               ('Engage', 'Young people take part in community life, dialogue and civic action.')]),
    'women-empowerment': dict(
        title='Confidence, skills <span class="text-white/45">and a voice.</span>',
        view='We believe lasting change for women comes from confidence as much as skills. We open access to learning, leadership and economic opportunities so women can take a full part in community life and decision-making.',
        principles=['Equal opportunities', 'Economic independence', 'Safe spaces'],
        steps=[('Build confidence', 'Supportive spaces where women strengthen their capacities and self-belief.'),
               ('Learn', 'Access to learning, leadership training and training of trainers.'),
               ('Earn', 'Entrepreneurial skills, mentoring and connections to economic opportunities.'),
               ('Participate', 'Meaningful participation in community life and decision-making.')]),
    'green-thumbs': dict(
        title='Local action, <span class="text-white/45">national dialogue.</span>',
        view='Climate action starts close to home. We help communities understand environmental challenges, act on them locally, and carry their perspectives into dialogue on Morocco’s climate priorities and commitments.',
        principles=['Community-led', 'Sustainable practices', 'Climate resilience'],
        steps=[('Raise awareness', 'Environmental education and awareness campaigns with residents and young people.'),
               ('Act locally', 'Locally led initiatives that protect the environment and encourage sustainable practices.'),
               ('Build resilience', 'Communities better prepared for the effects of climate change.'),
               ('Shape policy', 'Consultations and dialogue connecting local voices to national climate policy.')]),
    'digital-empowerment': dict(
        title='From access <span class="text-white/45">to innovation.</span>',
        view='Digital skills should not depend on where you live. We widen access to digital knowledge and give young people and communities the chance to explore AI, science and emerging technologies to solve real problems.',
        principles=['Access for all', 'Learning by doing', 'Responsible innovation'],
        steps=[('Access', 'Digital literacy and skills for young people and communities.'),
               ('Explore', 'Hands-on discovery of artificial intelligence, science and emerging technologies.'),
               ('Apply', 'Practical innovation activities that tackle real learning and community problems.'),
               ('Connect', 'Exchange and cooperation that link local innovators with wider networks.')]),
}
PILLAR_SHORT = {'youth-empowerment': 'Youth', 'women-empowerment': 'Women', 'green-thumbs': 'Environment', 'digital-empowerment': 'Digital'}


def pillars():
    # ---- one page per pillar
    for i, (slug, n, t, d, rel) in enumerate(PILLARS):
        tone = PILLAR_TONE[slug]
        objs = [(ref, text, desc) for ref, text, desc, links in OBJECTIVES if any(sl == slug for _n, sl in links)]
        projs = [p for p in PROJECTS if slug in PROJECT_PILLARS.get(p[0], [p[1]])]
        linked = [o[0] for o in objs]
        cross = [(r, t, d_) for r, t, d_, l in OBJECTIVES if not l]
        rest = [(r, t, d_) for r, t, d_, l in OBJECTIVES if l and r not in linked]
        four = ([(o, 'Core objective', True) for o in objs] + [(o, 'Cross-cutting', False) for o in cross] + [(o, 'Other AFCD objective', False) for o in rest])[:4]
        obj_html = ''.join(f'''
        <li><a href="strategy.html#{ref.lower()}" class="so-card so-mini group h-full{' is-core' if core else ''}" style="--c:{tone}"><span class="flex items-center justify-between gap-3"><span class="so-ref">{ref}</span><span class="so-kind">{kind}</span></span><span class="mt-6 block text-[18px] font-semibold leading-[1.25] tracking-[-0.02em]">{text}</span><span class="mt-3 block text-[14px] leading-relaxed text-ink-dark">{desc}</span><span class="nw-read">View in strategy <span aria-hidden="true">↗</span></span></a></li>''' for (ref, text, desc), kind, core in four)
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
        acts = ''.join(f'''<li class="wd-card" style="--c:{tone}"><span class="flex items-start justify-between"><span class="wd-ico"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ACT_ICONS[a]}</svg></span><span class="wd-n">{j:02d}</span></span><span class="mt-8 block text-[16.5px] font-medium leading-[1.45] tracking-[-0.01em]">{ACTIVITIES[a]}</span></li>''' for j, a in enumerate(PILLAR_ACTS[slug], 1))
        groups = ''.join(f'<li class="wd-person"><span class="wd-av" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="7" r="3"/><path d="M4 16.5c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6"/></svg></span><span>{BENEFICIARIES[g]}</span></li>' for g in PILLAR_GROUPS[slug])
        ap = PILLAR_APPROACH[slug]
        steps = ''.join(f'<li class="ap-step" style="--c:{tone}"><span class="ap-step-n">{j:02d}</span><span class="min-w-0"><span class="block text-[18px] font-semibold tracking-[-0.02em]">{a}</span><span class="mt-1 block text-[14px] leading-relaxed text-ink-dark">{b}</span></span></li>' for j, (a, b) in enumerate(ap['steps'], 1))
        princ = ''.join(f'<li class="ap-pr"><span class="pj-dot" style="--c:{tone}"></span>{x}</li>' for x in ap['principles'])
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
  <div class="wrap">{sec_head('01 / Strategic Objectives', 'What we aim <span class="sh-soft">to achieve.</span>', f'{len(objs)} core · 6 in total', desc='The objectives at the core of this pillar, alongside AFCD’s wider strategy.')}
    <ul class="mt-8 grid gap-3 sm:grid-cols-2 lg:mt-10 lg:grid-cols-4">{obj_html}
    </ul>
  </div>
</section>

<section id="what-we-do" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / What We Do', 'How this pillar <span class="sh-soft">comes to life.</span>', 'Activities · Participants', desc='The kinds of activities AFCD runs under this pillar, and the people they involve.')}
    <ul class="wd-grid mt-8 lg:mt-10">{acts}</ul>
    <div class="wd-who mt-3" style="--c:{tone}">
      <div class="wd-who-head">
        <p class="label text-black/60">Who we work with</p>
        <p class="mt-3 text-[22px] font-semibold leading-[1.15] tracking-[-0.03em] md:text-[26px]">The people <span class="text-black/45">behind the work.</span></p>
        <p class="mt-3 text-[13.5px] leading-relaxed text-black/60">Participants and criteria vary by programme.</p>
      </div>
      <ul class="wd-people">{groups}</ul>
    </div>
  </div>
</section>

<section id="approach" class="py-6 lg:py-8">
  <div class="wrap">
    <div class="ap-band">
      <div class="grid gap-10 lg:grid-cols-12 lg:gap-14">
        <div class="flex flex-col lg:col-span-5">
          <div class="sh-top"><span class="sh-num">03</span><span class="sh-label">Our Approach</span></div>
          <p class="mt-8 text-[34px] font-semibold leading-[1.04] tracking-[-0.045em] md:text-[46px]">{ap['title'].replace('text-white/45', 'text-ink-mid')}</p>
          <div class="ap-view mt-8" style="--c:{tone}">
            <p class="label text-ink-mid">Our perspective</p>
            <p class="mt-3 text-[16.5px] leading-[1.6] text-ink-pure">{ap['view']}</p>
          </div>
          <p class="label mt-8 text-ink-mid">Guiding principles</p>
          <ul class="mt-3 flex flex-wrap gap-2">{princ}</ul>
        </div>
        <ol class="ap-steps lg:col-span-7">{steps}</ol>
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
DETAILS = {p['file']: dict(name=p['name'], pillar=_PILLAR_NAMES[p['pillar']], slug=p['pillar'], cat=p['category'], **p['detail'])
           for p in _PROJECT_DATA if p.get('detail') and p.get('file')}


PILLAR_TONE = {'youth-empowerment': '#FFB2B9', 'women-empowerment': '#A8DDFB', 'green-thumbs': '#82E591', 'digital-empowerment': '#FBE38A'}


def project_details():
    files = list(DETAILS)
    for idx, (file, d) in enumerate(DETAILS.items()):
        pevents = [x for x in EVENTS if x.get('project') == file]
        tone = PILLAR_TONE[d['slug']]
        pdesc = next(p[3] for p in PILLARS if p[0] == d['slug'])
        if d.get('objectives'):
            objs = [(ref, text) for ref, text, _desc, _l in OBJECTIVES if ref in d['objectives']]
        else:
            objs = [(ref, text) for ref, text, _desc, links in OBJECTIVES if any(sl == d['slug'] for _n, sl in links)]
        hero = media_img(d.get('hero'), 'aspect-[16/10] w-full rounded-[28px] md:aspect-[21/9]', eager=True) or ph(d['photo'], 'aspect-[16/10] w-full rounded-[28px] md:aspect-[21/9]')
        gal = d.get('gallery') or []
        def g(i, cls):
            return media_img(gal[i], cls + ' w-full rounded-[24px]', '(min-width:1024px) 50vw, 100vw') if i < len(gal) else ph(d['name'] + ' · gallery', cls + ' w-full rounded-[24px]')
        rev = d.get('revision') or ''
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

<section class="pt-8 lg:pt-10" data-studio-rev="{rev}">
  <div class="wrap">
    <div class="pj-hero">
      {hero}
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

<section id="events" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('03 / Events', 'Project <span class="sh-soft">events.</span>', f'{len(pevents)} linked' if pevents else 'None yet', ('All events', 'events.html'))}
    {f'<ul class="ev-list mt-8 lg:mt-10">{"".join(event_row(x, compact=True) for x in pevents)}</ul>' if pevents else '<div class="mt-8 rounded-[24px] border border-dashed border-ink-light p-6 text-[15px] text-ink-dark lg:mt-10">No events linked to this project yet. <a class="link-arrow ml-1" href="events.html">See all events ↗</a></div>'}
  </div>
</section>

<section id="gallery" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('04 / Gallery', 'In <span class="sh-soft">pictures.</span>', f'{len(gal)} photos' if gal else 'Photos to come')}
    <div class="pj-gallery mt-8 lg:mt-10">{''.join(g(i, 'pj-g1' if i == 0 else 'pj-gi') for i in range(max(8, len(gal))))}
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


# Stories come from src/data/news.json (written by AFCD Studio). Without it, the legacy NEWS list above is used.
_NEWS_FILE = Path(os.environ.get('STUDIO_NEWS_JSON') or Path(__file__).parent / 'data' / 'news.json')


def news_items():
    if _NEWS_FILE.exists():
        import json as _j
        return _j.loads(_NEWS_FILE.read_text(encoding='utf-8'))['articles']
    blog = 'https://afcdfoundation.org/blog/'
    return [dict(slug=f'legacy-{i}', url=blog, external=True, title=n[3], excerpt=n[4], type=NEWS_TYPES[i], pillar=n[0], colour=NEWS_PILLAR[n[0]],
                 date=n[1], dateLabel=n[2], hero=None, photo=n[5], featured=(i == 0)) for i, n in enumerate(NEWS)]


def news():
    items = news_items()
    lead = next((x for x in items if x.get('featured')), items[0] if items else None)
    rest = [x for x in items if x is not lead]
    blog = 'https://afcdfoundation.org/blog/'

    def link(x):
        # every story has its own page; stories first published on the old blog link to the original from that page
        return f'href="{x.get("file") or "news-" + x["slug"] + ".html"}"'

    def card(x=None, placeholder=None):
        if placeholder:
            pillar, typ, title, excerpt = placeholder
            return f'''
      <li class="nw-item" data-type="{typ}">
        <a href="#" class="nw-card group is-ph" aria-disabled="true" tabindex="-1">
          <div class="relative">{ph('Story photo', 'aspect-[16/10] w-full rounded-[20px]')}<span class="nw-type">{typ}</span></div>
          <span class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{NEWS_PILLAR[pillar]}"></span>{pillar}</span><span aria-hidden="true">·</span><span>Placeholder</span></span>
          <span class="mt-3 block text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">{title}</span>
          <span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{excerpt}</span>
          <span class="nw-read">Coming soon <span aria-hidden="true">↗</span></span>
        </a>
      </li>'''
        pic = media_img(x.get('hero'), 'aspect-[16/10] w-full rounded-[20px]', '(min-width:1024px) 33vw, 100vw') or ph(x.get('photo') or x['title'], 'aspect-[16/10] w-full rounded-[20px]')
        return f'''
      <li class="nw-item" data-type="{x['type']}">
        <a {link(x)} class="nw-card group">
          <div class="relative">{pic}<span class="nw-type">{x['type']}</span></div>
          <span class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{x['colour']}"></span>{x['pillar']}</span><span aria-hidden="true">·</span><time datetime="{x['date']}">{x['dateLabel']}</time></span>
          <span class="mt-3 block text-[21px] font-semibold leading-[1.2] tracking-[-0.025em]">{x['title']}</span>
          <span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{x['excerpt']}</span>
          <span class="nw-read">Read the story <span aria-hidden="true">↗</span></span>
        </a>
      </li>'''

    # Placeholders (clearly marked) only fill the grid up to six cards; real stories replace them.
    fill = NEWS_PLACEHOLDERS[:max(0, 6 - len(rest))]
    cards = ''.join(card(x) for x in rest) + ''.join(card(placeholder=p) for p in fill)
    present = [x['type'] for x in rest] + [p[1] for p in fill]
    types = ['All stories'] + [t for t in ['Call for applications', 'Participant story', 'Programme news', 'Event recap'] if t in present]
    chips = ''.join(f'<button type="button" class="nw-chip" data-news-filter="{"all" if i == 0 else t}" aria-pressed="{"true" if i == 0 else "false"}">{t}</button>' for i, t in enumerate(types))
    topics = ''.join(f'<li><a class="os-area" href="pillars.html#{sl}"><span class="os-area-dot" style="--c:{NEWS_PILLAR[n]}" aria-hidden="true"></span><span class="flex-1">{n}</span><span class="os-area-arr" aria-hidden="true">↗</span></a></li>'
                     for n, sl in [('Youth Empowerment', 'youth-empowerment'), ('Women’s Empowerment', 'women-empowerment'), ('Environment and Climate', 'green-thumbs'), ('Digital Inclusion and Innovation', 'digital-empowerment')])
    note = ('Some stories were first published on the afcdfoundation.org blog; their pages link to the original. ' if any(x.get('external') for x in items) else '') + \
           ('Lorem ipsum cards are placeholders until more stories are published.' if fill else '')
    feat = ''
    if lead:
        lpic = media_img(lead.get('hero'), 'aspect-[16/10] w-full rounded-[24px] lg:aspect-auto lg:h-full lg:min-h-[420px]', '(min-width:1024px) 60vw, 100vw', eager=True) or ph(lead.get('photo') or lead['title'], 'aspect-[16/10] w-full rounded-[24px] lg:aspect-auto lg:h-full lg:min-h-[420px]')
        feat = f'''
<section id="featured" class="pt-8 lg:pt-10">
  <div class="wrap">
    <a {link(lead)} class="nw-feat group">
      <div class="relative lg:col-span-7">{lpic}<span class="nw-type">Featured · {lead['type']}</span></div>
      <div class="flex flex-col p-2 lg:col-span-5 lg:p-6">
        <span class="flex flex-wrap items-center gap-x-3 text-[13px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{lead['colour']}"></span>{lead['pillar']}</span><span aria-hidden="true">·</span><time datetime="{lead['date']}">{lead['dateLabel']}</time></span>
        <h2 class="mt-5 text-[30px] font-semibold leading-[1.06] tracking-[-0.04em] md:text-[42px]">{lead['title']}</h2>
        <p class="mt-5 text-[16px] leading-relaxed text-ink-dark">{lead['excerpt']}</p>
        <span class="btn-dark btn-cta mt-8 min-h-[48px] self-start px-6 text-[14px] lg:mt-auto">Read the story <span class="arr" aria-hidden="true">↗</span></span>
      </div>
    </a>
  </div>
</section>
'''

    body = page_header([('News &amp; Stories', 'news.html')], 'News &amp; Stories',
                       'Stories from <span class="text-ink-mid">our communities.</span>',
                       'News, calls for applications and participant stories from AFCD’s programmes.') + feat + f'''
<section id="stories" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / All Stories', 'Latest from <span class="sh-soft">AFCD.</span>', ('Current blog', blog))}
    <div class="nw-chips mt-8" role="group" aria-label="Filter stories">{chips}</div>
    <ul class="nw-grid mt-6" id="news-grid">{cards}
    </ul>
    <p class="nw-empty mt-6 hidden text-[15px] text-ink-mid" role="status">No stories in this category yet.</p>
    {placeholder_note(note) if note else ''}
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


# ---------------------------------------------------------------- News article pages (template owned by the website session)
def news_articles():
    """One article page per Studio story (news-<slug>.html). External items link to the old blog and get no page.
    Field values from news_items() are already HTML-escaped; bodyHtml is already safe HTML."""
    all_items = news_items()
    # Studio stories have their own file; older stories that link to the old blog get a details page too.
    items = []
    for x in all_items:
        if not x.get('file'):
            x = dict(x, file=f"news-{x['slug']}.html")
        items.append(x)
    all_items = items
    for i, it in enumerate(items):
        body = it.get('bodyHtml') or ''
        sample = not body.strip()
        if sample:
            body = ('<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet.</p>'
                    '<p>Sed posuere consectetur est at lobortis. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum.</p>')
        hero = (media_img(it['hero'], 'aspect-[16/9] w-full rounded-[28px]', '(min-width:1280px) 1200px, 100vw', eager=True) if it.get('hero')
                else ph(it['title'], 'aspect-[16/9] w-full rounded-[28px]', '#E2E2E2'))
        pills = it.get('pillars') or []
        pillar_html = ''.join(f'<a href="{p["file"]}" class="na-tag"><span class="pj-dot" style="--c:{p.get("colour") or "#111"}"></span>{p["name"]}</a>' for p in pills) \
            or (f'<span class="na-tag"><span class="pj-dot" style="--c:{it.get("colour") or "#111"}"></span>{it.get("pillar", "")}</span>' if it.get('pillar') else '')
        tags = ''.join(f'<span class="na-tag">#{t}</span>' for t in (it.get('tags') or []))
        author = ''
        if it.get('authorName'):
            ini = ''.join(w[0] for w in it['authorName'].split()[:2]).upper()
            author = f'<div class="na-author"><span class="na-av">{ini}</span><span><span class="block text-[14px] font-semibold">{it["authorName"]}</span><span class="block text-[12.5px] text-ink-mid">{it.get("authorRole") or ""}</span></span></div>'
        gallery = it.get('gallery') or []
        ghtml = (f'<div class="na-gallery">{"".join(media_img(m, "aspect-[4/3] w-full rounded-[18px]", "(min-width:768px) 33vw, 50vw") for m in gallery)}</div>' if gallery else '')
        projects = it.get('projects') or []
        phtml = ''.join(f'<li><a href="{p["file"]}" class="na-proj"><span class="min-w-0 flex-1"><span class="block text-[15px] font-semibold">{p["name"]}</span><span class="block text-[13px] text-ink-mid">{p.get("category") or ""}</span></span><span aria-hidden="true">↗</span></a></li>' for p in projects if p.get('file'))
        related = [x for x in all_items if x is not it][:3]
        def card(x):
            href = x['file']
            return f'''
      <li><a href="{href}" class="nw-card group"><div class="relative">{media_img(x['hero'], 'aspect-[16/10] w-full rounded-[20px]', '(min-width:1024px) 33vw, 100vw') if x.get('hero') else ph(x['title'], 'aspect-[16/10] w-full rounded-[20px]')}<span class="nw-type">{x.get('type', 'Story')}</span></div><span class="mt-5 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-mid"><span class="inline-flex items-center gap-2 font-medium text-ink-pure"><span class="pj-dot" style="--c:{x.get('colour') or '#111'}"></span>{x.get('pillar', '')}</span><span aria-hidden="true">·</span><time datetime="{x.get('date', '')}">{x.get('dateLabel', '')}</time></span><span class="mt-3 block text-[19px] font-semibold leading-[1.25] tracking-[-0.02em]">{x['title']}</span><span class="nw-read">Read the story <span aria-hidden="true">↗</span></span></a></li>'''
        rel = ''.join(card(x) for x in related)
        pn = ''
        if len(items) > 1:
            pv, nx = items[i - 1], items[(i + 1) % len(items)]
            pn = f'''<nav class="na-pn" aria-label="More stories">
        <a href="{pv['file']}" class="pj-nav group"><span class="label text-ink-mid">Previous story</span><span class="mt-2 block text-[17px] font-semibold leading-snug tracking-[-0.015em]">{pv['title']}</span><span class="pj-nav-arr" aria-hidden="true">↗</span></a>
        <a href="{nx['file']}" class="pj-nav group"><span class="label text-ink-mid">Next story</span><span class="mt-2 block text-[17px] font-semibold leading-snug tracking-[-0.015em]">{nx['title']}</span><span class="pj-nav-arr" aria-hidden="true">↗</span></a>
      </nav>'''
        minutes = it.get('readMinutes') or max(1, round(len((it.get('excerpt', '') + body).split()) / 200))
        body_html = page_header([('News &amp; Stories', 'news.html'), (it['title'], it['file'])], it.get('type') or 'Story', it['title'], it.get('excerpt', '')) + f'''

<article class="na" data-studio-article-rev="{it.get('revision', '')}">
  <div class="wrap pt-8 lg:pt-10">
    <div class="na-hero">{hero}</div>
  </div>

  <div class="wrap na-grid py-12 lg:py-16">
    <aside class="na-rail">
      {author}
      <dl class="na-meta">
        <div><dt>Published</dt><dd><time datetime="{it.get('date', '')}">{it.get('dateLabel', '')}</time></dd></div>
        <div><dt>Type</dt><dd>{it.get('type') or 'Story'}</dd></div>
        <div><dt>Reading time</dt><dd>{minutes} min</dd></div>
      </dl>
      <div class="na-tags">{pillar_html}{tags}</div>
      <div class="na-share">
        <button type="button" class="na-copy" data-copy-link><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-.8.8M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l.8-.8"/></svg><span>Copy link</span></button>
        <a class="na-back" href="news.html">← All stories</a>
      </div>
    </aside>

    <div class="na-body">
      {'<p class="na-sample">Sample article text: the full story will replace this.</p>' if sample else ''}
      <p class="na-lead">{it.get('excerpt', '')}</p>
      <div class="na-prose">{body}</div>
      {f'<div class="na-callout"><p class="text-[15px] font-semibold">First published on the AFCD blog</p><p class="mt-1 text-[14px] leading-relaxed text-ink-dark">Read the full original post on afcdfoundation.org.</p><a href="{it["url"]}" class="btn-dark btn-cta mt-4 min-h-[44px] px-5 text-[13.5px]">Read the original {ARR}</a></div>' if it.get('external') and it.get('url') else ''}
      {ghtml}
      {f'<div class="na-related-proj"><p class="label text-ink-mid">Related projects</p><ul class="mt-3 grid gap-2">{phtml}</ul></div>' if phtml else ''}
      {pn}
    </div>
  </div>
</article>

{f"""<section id="related" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('More Stories', 'Keep <span class="sh-soft">reading.</span>', ('All stories', 'news.html'))}
    <ul class="nw-grid mt-8 lg:mt-10">{rel}
    </ul>
  </div>
</section>""" if rel else ''}
''' + cta_band('Have a story to share?', 'Alumni, volunteers and partners: tell us about the change you’ve seen.',
               ('Contact us', 'contact.html'), ('Get Involved', 'get-involved.html'))
        page(it['file'], f"{it.get('seoTitle') or it['title']} · News · AFCD Foundation", (it.get('seoDescription') or it.get('excerpt', ''))[:155], 'news', body_html, parent=('News &amp; Stories', 'news.html'))


# ---------------------------------------------------------------- Events
# Sample events: clearly marked placeholders until AFCD supplies its real calendar (e.g. through Studio).
EVENTS = [
    dict(slug='leadership-workshop', project='project-leadership-lab.html', day='12', mon='Dec', year='2026', iso='2026-12-12', kind='Workshop', pillar='youth-empowerment', title='Lorem ipsum leadership workshop', where='Ait Ourir', time='10:00 – 13:00', desc='Consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet.', upcoming=True),
    dict(slug='community-clean-up', project='project-eco-citizen.html', day='20', mon='Jan', year='2027', iso='2027-01-20', kind='Community day', pillar='green-thumbs', title='Dolor sit amet community clean-up', where='Al Haouz', time='09:00 – 16:00', desc='Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum.', upcoming=True),
    dict(slug='training-of-trainers', project=None, day='08', mon='Feb', year='2027', iso='2027-02-08', kind='Training', pillar='women-empowerment', title='Amet consectetur training of trainers', where='Marrakech', time='14:00 – 18:00', desc='Maecenas faucibus mollis interdum. Nullam quis risus eget urna mollis ornare vel eu leo.', upcoming=True),
    dict(slug='digital-skills-webinar', project=None, day='27', mon='Feb', year='2027', iso='2027-02-27', kind='Webinar', pillar='digital-empowerment', title='Adipiscing elit digital skills webinar', where='Online', time='18:00 – 19:30', desc='Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor.', upcoming=True),
    dict(slug='bootcamp', project='project-leadership-lab.html', day='18', mon='Oct', year='2026', iso='2026-10-18', kind='Bootcamp', pillar='youth-empowerment', title='Sed posuere bootcamp', where='Marrakech', time='3 days', desc='Etiam porta sem malesuada magna mollis euismod.', upcoming=False),
    dict(slug='environmental-screening', project='project-youth-green-generation.html', day='05', mon='Jun', year='2026', iso='2026-06-05', kind='Festival', pillar='green-thumbs', title='Nulla vitae environmental screening', where='Al Haouz', time='Evening', desc='Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh.', upcoming=False),
]
# Studio loader (owned by AFCD Studio): when src/data/events.json exists it replaces EVENTS with real events
# (same keys as above plus sample=False, studio=True, revision, endIso, online, bodyHtml, agenda, audience, poster,
# registration, recap, seoTitle, seoDescription). All values are already HTML-escaped. Studio writes the file only
# while at least one event is live, so the sample list above is used otherwise.
_EVENTS_FILE = Path(os.environ.get('STUDIO_EVENTS_JSON') or Path(__file__).parent / 'data' / 'events.json')
if _EVENTS_FILE.exists():
    import json as _ej
    EVENTS = _ej.loads(_EVENTS_FILE.read_text(encoding='utf-8'))['events']
# End of Studio loader.
EV_ICON = {
    'pin': '<path d="M10 17s5-4.6 5-9a5 5 0 0 0-10 0c0 4.4 5 9 5 9Z"/><circle cx="10" cy="8" r="1.8"/>',
    'clock': '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
}


def event_file(e):
    return f"event-{e['slug']}.html"


def ev_ico(k):
    return f'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{EV_ICON[k]}</svg>'


def ev_sample(e):
    return e.get('sample', True)


def ev_badge(e):
    return '<span class="ev-sample">Sample event</span>' if ev_sample(e) else ''


def ev_poster(e, cls, sizes='(min-width:1024px) 400px, 100vw', label='Event poster · 1:1', tone='#E2E2E2'):
    if e.get('poster'):
        return media_img(e['poster'], cls, sizes)
    return ph(label, cls, tone)


def ev_reg_target(e):
    """(href, label, external) for an upcoming event's registration, or None."""
    if not e['upcoming']:
        return None
    reg = {'mode': 'contact', 'label': 'Register interest'} if ev_sample(e) else (e.get('registration') or {'mode': 'none'})
    mode, label = reg.get('mode'), reg.get('label') or 'Register'
    if mode == 'external' and reg.get('url'):
        return (reg['url'], label, True)
    if mode == 'contact':
        return ('contact.html?topic=General+question#message', label, False)
    return None


def ev_register(e, block=False):
    """Registration action for an event: contact form, external link or nothing (Studio events); contact for samples."""
    size = 'mt-5 min-h-[50px] w-full justify-center px-6' if block else 'min-h-[50px] px-7'
    if not e['upcoming']:
        rc = e.get('recap')
        if rc and rc.get('url'):
            return f'<a href="{rc["url"]}" class="btn-dark btn-cta {size}">Read the recap {ARR}</a>'
        return '<p class="mt-5 rounded-2xl bg-[#F6F6F6] px-4 py-3 text-[14px] text-ink-dark">This event has ended. See upcoming events below.</p>' if block else ''
    tgt = ev_reg_target(e)
    if not tgt:
        return ''
    href, label, ext = tgt
    if ext:
        return f'<a href="{href}" target="_blank" rel="noopener" class="btn-dark btn-cta {size}">{label} {ARR}</a>'
    note = '<p class="mt-3 text-[12.5px] leading-relaxed text-ink-mid">Registration isn’t online yet: this sends us a message and we confirm your place.</p>' if block else ''
    return f'<a href="{href}" class="btn-dark btn-cta {size}">{label} {ARR}</a>{note}'


def event_row(e, compact=False):
    """One event as a row: date tile, details, action. Used on the Events page, homepage and project pages."""
    pname = next(p[2] for p in PILLARS if p[0] == e['pillar'])
    state = 'Upcoming' if e['upcoming'] else 'Past'
    act = (f'<a href="{event_file(e)}" class="ev-act">View details <span aria-hidden="true">↗</span></a>' if e['upcoming']
           else f'<a href="{event_file(e)}" class="ev-act is-past">Event recap <span aria-hidden="true">↗</span></a>')
    return f'''
      <li class="ev-row{' is-past' if not e['upcoming'] else ''}" data-when="{state.lower()}">
        <time class="ev-date" datetime="{e['iso']}"><span class="ev-day">{e['day']}</span><span class="ev-mon">{e['mon']} {e['year']}</span></time>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">{e['kind']}</span><span class="ev-pillar"><span class="pj-dot" style="--c:#111"></span>{pname}</span>{ev_badge(e)}</div>
          {f'<p class="ev-proj mt-2">Part of <a href="{e["project"]}">{DETAILS[e["project"]]["name"]}</a></p>' if e.get('project') in DETAILS else ''}
          <p class="mt-3 text-[19px] font-semibold leading-snug tracking-[-0.02em] md:text-[21px]"><a href="{event_file(e)}" class="ev-link">{e['title']}</a></p>
          {'' if compact else f'<p class="mt-1.5 max-w-[62ch] text-[14.5px] leading-relaxed text-ink-dark">{e["desc"]}</p>'}
          <p class="ev-meta mt-3"><span>{ev_ico('pin')}{e['where']}</span><span>{ev_ico('clock')}{e['time']}</span></p>
        </div>
        <div class="ev-poster" aria-hidden="true">{ev_poster(e, 'aspect-square w-full rounded-[16px]', '96px', 'Poster', '#E6E6E6')}</div>
        {act}
      </li>'''


def events():
    up = [e for e in EVENTS if e['upcoming']]
    past = [e for e in EVENTS if not e['upcoming']]
    any_sample = any(ev_sample(x) for x in EVENTS)
    feat = up[0] if up else (past[0] if past else None)
    pname = next(p[2] for p in PILLARS if p[0] == feat['pillar']) if feat else ''
    chips = (f'<button type="button" class="nw-chip" data-ev="all" aria-pressed="true">All <span class="pr-count">{len(EVENTS)}</span></button>'
             f'<button type="button" class="nw-chip" data-ev="upcoming" aria-pressed="false">Upcoming <span class="pr-count">{len(up)}</span></button>'
             f'<button type="button" class="nw-chip" data-ev="past" aria-pressed="false">Past <span class="pr-count">{len(past)}</span></button>')
    rows = ''.join(event_row(e) for e in up + past)
    next_html = (f'''<section id="next" class="pt-8 lg:pt-10">
  <div class="wrap">
    <article class="ev-feat">
      <div class="ev-feat-date"><span class="label text-white/55">{'Next event' if feat['upcoming'] else 'Latest event'}</span><span class="ev-feat-day">{feat['day']}</span><span class="text-[15px] font-medium">{feat['mon']} {feat['year']}</span><span class="mt-auto text-[13px] text-white/55">{feat['time']}</span></div>
      <div class="flex min-w-0 flex-col p-6 md:p-9">
        <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">{feat['kind']}</span><span class="ev-pillar"><span class="pj-dot" style="--c:#111"></span>{pname}</span>{ev_badge(feat)}</div>
        <h2 class="mt-5 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[42px]"><a href="{event_file(feat)}" class="ev-link">{feat['title']}</a></h2>
        <p class="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-ink-dark">{feat['desc']}</p>
        <p class="ev-meta mt-5"><span>{ev_ico('pin')}{feat['where']}</span><span>{ev_ico('clock')}{feat['time']}</span></p>
        <div class="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 lg:mt-auto lg:pt-8">
          {ev_register(feat)}
          <a href="{event_file(feat)}" class="link-arrow">View details {ARR}</a>
        </div>
      </div>
      <div class="ev-feat-photo">{ev_poster(feat, 'aspect-square w-full rounded-[22px]')}</div>
    </article>
  </div>
</section>''' if feat else '')
    body = page_header([('Events', 'events.html')], 'Events',
                       'Meet us <span class="text-ink-mid">in the community.</span>',
                       'Workshops, trainings, community days and online sessions across Morocco. Join an event or register your interest.') + f'''

{next_html}

<section id="calendar" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Calendar', 'Upcoming <span class="sh-soft">and past events.</span>', f'{len(EVENTS)} events', desc='Dates, places and how to take part. Filter to see what’s coming up.')}
    <div class="mt-8 nw-chips" role="group" aria-label="Filter events">{chips}</div>
    <ul id="event-list" class="ev-list mt-6">{rows}
    </ul>
    <p class="ev-empty mt-6 hidden text-[15px] text-ink-mid" role="status">No events in this view yet.</p>
    {placeholder_note('These are sample events (lorem ipsum) to show the layout. AFCD will publish its real event calendar here.') if any_sample else ''}
  </div>
</section>

<section id="host" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap grid gap-4 lg:grid-cols-12">
    <div class="rounded-[28px] border border-ink-light p-6 md:p-8 lg:col-span-5">
      <p class="label text-ink-mid">Host or co-organise</p>
      <p class="mt-4 text-[26px] font-semibold leading-[1.1] tracking-[-0.03em]">Bring an AFCD event <span class="text-ink-mid">to your community.</span></p>
      <p class="mt-3 text-[15px] leading-relaxed text-ink-dark">Schools, associations and partners can propose a workshop, training or community day with us.</p>
      <a href="contact.html?topic=Partnership#message" class="link-arrow mt-6">Propose an event {ARR}</a>
    </div>
    <div class="os-band on-dark text-white lg:col-span-7">
      <span class="cta-kicker" style="background:#fff;color:#000"><span class="tb-dot" aria-hidden="true"></span>Newsletter</span>
      <p class="mt-6 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[40px]">Never miss <span class="text-white/45">an event.</span></p>
      <p class="mt-4 max-w-[46ch] text-[15.5px] leading-relaxed text-white/65">New events, calls for applications and stories, a few times a year.</p>
      <a href="#ft-news-title" class="btn-light btn-cta mt-8 min-h-[48px] px-6 text-[14px]">Subscribe <span class="arr" aria-hidden="true">↓</span></a>
    </div>
  </div>
</section>
''' + cta_band('See you at the next one.', 'Volunteer at an event, join a programme or partner with us on a community day.',
               ('Get Involved', 'get-involved.html'), ('Contact us', 'contact.html'))
    # ---- one details page per event
    # Layout: main column (about tabs, programme, speakers, location, FAQ) + one sticky card holding every
    # practical fact once (date, time, place, format, project, pillar, registration, calendar, share).
    from datetime import date as _date
    import html as _html
    from urllib.parse import quote_plus as _qp
    EVD_I = {
        'cal': '<rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/>',
        'share': '<path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5"/><path d="M4.5 10.5v5A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5v-5"/>',
        'plus': '<path d="M10 4.5v11M4.5 10h11"/>',
        'map': '<path d="m2.5 5 5-2 5 2 5-2v12l-5 2-5-2-5 2V5Z"/><path d="M7.5 3v12M12.5 5v12"/>',
        'online': '<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6M10 14v3"/>',
    }

    def evd_ico(k, cls=''):
        return f'<svg class="{cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{EVD_I[k]}</svg>'

    CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5"/></svg>'

    def initials(name):
        w = [x for x in _html.unescape(name).split() if x[:1].isalpha()]
        return ''.join(x[0] for x in w[:2]).upper() or '?'

    for i, e in enumerate(EVENTS):
        pname = next(p[2] for p in PILLARS if p[0] == e['pillar'])
        others = [x for x in EVENTS if x is not e and x['upcoming']][:3]
        sample = ev_sample(e)
        online = bool(e.get('online')) or _html.unescape(e['where']).strip().lower() == 'online'
        try:
            weekday = _date.fromisoformat(e['iso']).strftime('%A')
        except ValueError:
            weekday = ''

        # -- the sticky card: each practical fact appears here and nowhere else
        facts = [('Time', e['time']), ('Location', f'<a class="evd-fact-link" href="#where">{e["where"]}</a>'), ('Format', e['kind'])]
        if e.get('project') and e['project'] in DETAILS:
            facts.append(('Project', f'<a class="evd-fact-link" href="{e["project"]}">{DETAILS[e["project"]]["name"]}</a>'))
        # Partner(s): Studio supplies real names; samples show a neutral placeholder, never a real partner
        ev_partners = ['Partner name'] if sample else [x for x in (e.get('partners') or []) if x]
        if ev_partners:
            facts.append(('Partner' if len(ev_partners) == 1 else 'Partners', '<span class="evd-partners">' + ''.join(
                f'<span class="evd-partner"><span class="evd-partner-mark" aria-hidden="true">{initials(n)}</span>{n}</span>' for n in ev_partners) + '</span>'))
        facts.append(('Pillar', f'<span class="inline-flex items-center gap-1.5"><span class="pj-dot" style="--c:#111"></span>{pname}</span>'))
        fhtml = ''.join(f'<div class="evd-fact"><dt>{a}</dt><dd>{b}</dd></div>' for a, b in facts)
        count = f'<span class="evd-count" data-countdown="{e["iso"]}" hidden></span>' if e['upcoming'] else '<span class="evd-count is-past">Past event</span>'
        cal = (f'<button type="button" class="evd-tool" data-ics data-uid="afcd-{e["slug"]}" data-start="{e["iso"]}" data-time="{e["time"]}" '
               f'data-title="{e["title"]}" data-where="{e["where"]}">{evd_ico("cal")}Add to calendar</button>') if e['upcoming'] else ''
        tools = f'<div class="evd-tools{" is-one" if not cal else ""}">{cal}<button type="button" class="evd-tool" data-share>{evd_ico("share")}Share</button></div>'
        card = f'''<aside class="evd-side" aria-label="Event details and registration">
      <div class="evd-card" id="register">
        <div class="flex flex-wrap items-center gap-2"><span class="ev-kind">{e['kind']}</span>{ev_badge(e)}{count}</div>
        <div class="evd-when mt-5"><time class="evd-day" datetime="{e['iso']}">{e['day']}</time><span><span class="block text-[18px] font-semibold tracking-[-0.02em]">{e['mon']} {e['year']}</span><span class="block text-[14px] text-ink-mid">{weekday}</span></span></div>
        <dl class="evd-facts mt-4">{fhtml}</dl>
        {ev_register(e, block=True)}
        {tools}
      </div>
    </aside>'''

        # -- main column blocks, numbered in order
        blocks = []
        poster = f'<div class="evd-ov-poster">{ev_poster(e, "aspect-square w-full rounded-[24px]", "(min-width:1024px) 400px, 100vw")}</div>'
        if sample:
            outcomes = ['Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 'Vestibulum id ligula porta felis euismod semper.',
                        'Cras mattis consectetur purus sit amet fermentum.', 'Aenean lacinia bibendum nulla sed consectetur.']
            ohtml = ''.join(f'<li class="evt-out"><span class="evt-out-n">{j:02d}</span><span class="block text-[16px] font-medium leading-snug">{o}</span></li>' for j, o in enumerate(outcomes, 1))
            who = ['Lorem ipsum: young people and students', 'Dolor sit: community volunteers', 'Amet: local associations and partners']
            whtml = ''.join(f'<li class="gi-check">{CHECK}<span>{w}</span></li>' for w in who)
            about_html = f'''<div class="evd-ov"><div class="grid content-start gap-4 text-[16px] leading-[1.75] text-ink-dark">
            <h3 class="evd-ov-h">Overview</h3>
            <p class="text-[20px] leading-[1.5] tracking-[-0.01em] text-ink-pure">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet.</p>
            <p>Sed posuere consectetur est at lobortis. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum.</p>
            <p>Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor. Nulla vitae elit libero, a pharetra augue.</p></div>{poster}</div>'''
            extra = [('Outcomes & Audience', 'What you’ll <span class="sh-soft">take away.</span>', f'''<div class="evd-oa mt-8"><div><p class="evd-sub">Outcomes</p><ul class="evt-outcomes is-stack mt-4">{ohtml}</ul></div><div class="grid content-start gap-3">
            <div class="os-band on-dark text-white" style="padding:28px"><p class="label text-white/55">Who should attend</p><ul class="evd-who mt-5 grid gap-3">{whtml}</ul></div>
            <div class="rounded-[28px] border border-ink-light p-6"><p class="text-[18px] font-semibold tracking-[-0.02em]">Not sure it’s for you?</p><p class="mt-2 text-[14.5px] leading-relaxed text-ink-dark">Send us a short message and we’ll tell you whether this event fits what you’re looking for.</p><a href="contact.html?topic=General+question#message" class="link-arrow mt-5">Ask a question {ARR}</a></div></div></div>''', 'outcomes')]
            agenda = [dict(time='10:00', title='Arrival and welcome', text='Introductions. Lorem ipsum dolor sit amet.'),
                      dict(time='10:30', title='Session 1', text='Consectetur adipiscing elit, sed do eiusmod tempor.'),
                      dict(time='11:30', title='Break', text='Networking and refreshments.'),
                      dict(time='11:45', title='Session 2', text='Ut enim ad minim veniam, quis nostrud exercitation.'),
                      dict(time='12:45', title='Close', text='Next steps and how to stay involved.')]
            speakers = [dict(name='Speaker Name', role='Facilitator · Lorem ipsum'), dict(name='Host Name', role='AFCD team · Dolor sit'),
                        dict(name='Guest Name', role='Partner organisation · Amet')]
            faq = [dict(q='Is the event free?', a='Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sample answer until AFCD confirms the details.'),
                   dict(q='Do I need to bring anything?', a='Vestibulum id ligula porta felis euismod semper. Sample answer.'),
                   dict(q='Will I receive a certificate?', a='Cras mattis consectetur purus sit amet fermentum. Sample answer.'),
                   dict(q='Is the venue accessible?', a='Aenean lacinia bibendum nulla sed consectetur. Sample answer.')]
        else:
            body_html = (e.get('bodyHtml') or '').strip()
            ov = (f'<div class="evd-ov"><div><h3 class="evd-ov-h">Overview</h3><div class="na-prose" style="margin-top:16px">{body_html}</div></div>{poster}</div>' if body_html
                  else f'<div class="evd-ov is-solo">{poster}</div>')
            about_html = ov
            extra = []
            if e.get('audience'):
                au = ''.join(f'<li class="gi-check">{CHECK}<span>{w}</span></li>' for w in e['audience'])
                extra.append(('Who Should Attend', 'Who it’s <span class="sh-soft">for.</span>', f'<div class="os-band on-dark mt-8 text-white" style="padding:28px"><ul class="evd-who grid gap-3">{au}</ul></div>', 'audience'))
            agenda = e.get('agenda') or []
            speakers = e.get('speakers') or []
            faq = e.get('faq') or []

        blocks.append(('About This Event', 'What to <span class="sh-soft">expect.</span>', f'<div class="mt-8">{about_html}</div>', 'about', False))
        blocks.extend((lab, t, c, bid, False) for lab, t, c, bid in extra)
        if agenda:
            tl = ''.join(f'''<li><span class="evd-tl-time">{x.get('time', '')}</span><span class="evd-tl-rail" aria-hidden="true"></span><div class="evd-tl-body"><p class="text-[16px] font-semibold tracking-[-0.015em]">{x.get('title', '')}</p>{f'<p class="mt-1 text-[14px] leading-relaxed text-ink-dark">{x["text"]}</p>' if x.get('text') else ''}</div></li>''' for x in agenda)
            blocks.append(('Programme', 'How the <span class="sh-soft">day runs.</span>', f'<ol class="evd-tl mt-8">{tl}</ol>', 'programme', False))
        if speakers:
            sp = ''.join(f'''<li class="evd-sp-card">{media_img(s['photo'], 'evd-av', '88px') if s.get('photo') else f'<span class="evd-av" aria-hidden="true">{initials(s["name"])}</span>'}<p class="mt-4 text-[16px] font-semibold tracking-[-0.015em]">{s['name']}</p><p class="mt-1 text-[13.5px] leading-snug text-ink-mid">{s.get('role', '')}</p></li>''' for s in speakers)
            blocks.append(('Speakers & Hosts', 'Who you’ll <span class="sh-soft">meet.</span>', f'<ul class="evd-sp mt-8">{sp}</ul>', 'speakers', False))
        if online:
            loc = f'''<div class="evd-loc mt-8"><span class="evd-loc-ico">{evd_ico('online')}</span><span class="min-w-0"><span class="block text-[18px] font-semibold tracking-[-0.02em]">Online event</span><span class="mt-1 block text-[14px] leading-relaxed text-ink-dark">The joining link is sent to registered participants before the session.</span></span></div>'''
        else:
            maps = 'https://www.google.com/maps/search/?api=1&amp;query=' + _qp(_html.unescape(e['where']) + ', Morocco')
            loc = f'''<div class="evd-where mt-8">
          <div class="evd-loc"><span class="evd-loc-ico">{ev_ico('pin')}</span><span class="min-w-0"><span class="block text-[18px] font-semibold tracking-[-0.02em]">{e['where']}, Morocco</span><span class="mt-1 block text-[14px] leading-relaxed text-ink-dark">The exact venue is shared with registered participants.</span>
            <a href="{maps}" target="_blank" rel="noopener" class="evd-maps">{evd_ico('map')}Open in Maps <span aria-hidden="true">↗</span></a></span></div>
          <div class="evd-map" role="img" aria-label="Map preview: {e['where']}"><span class="evd-map-road r1"></span><span class="evd-map-road r2"></span><span class="evd-map-road r3"></span><span class="evd-map-pin">{ev_ico('pin')}</span><span class="evd-map-tag">{e['where']}</span></div>
        </div>'''
        blocks.append(('Location', 'Where <span class="sh-soft">we meet.</span>', loc, 'where', False))
        if faq:
            fq = ''.join(f'''<details class="evd-q"><summary>{x['q']}<span class="evd-q-ico">{evd_ico('plus')}</span></summary><p>{x['a']}</p></details>''' for x in faq)
            blocks.append(('Questions', 'Good <span class="sh-soft">to know.</span>', f'<div class="evd-faq mt-8">{fq}</div>', 'faq', False))

        main = ''.join(f'''
      <section id="{bid}" class="evd-block"{' data-tabs' if tabbed else ''} aria-labelledby="{bid}-h">{sec_head(f'{k:02d} / {lab}', f'<span id="{bid}-h">{title}</span>', 'Sample text' if sample and k == 1 else '')}
        {content}
      </section>''' for k, (lab, title, content, bid, tabbed) in enumerate(blocks, 1))

        orows = ''.join(event_row(x, compact=True) for x in others)
        if not orows:
            orows = '<li class="rounded-[24px] border border-dashed border-ink-light p-6 text-[15px] text-ink-dark">No other upcoming events right now. <a class="link-arrow ml-1" href="events.html">See all events ↗</a></li>'
        bar = ''
        tgt = ev_reg_target(e)
        if tgt:
            href, label, ext = tgt
            bar = f'''
<div class="evd-bar" data-evd-bar hidden><span class="min-w-0"><span class="block text-[11px] uppercase tracking-[.14em] text-white/55">{e['kind']}</span><span class="block truncate text-[14px] font-semibold">{e['day']} {e['mon']} · {e['time']}</span></span><a href="{href}"{' target="_blank" rel="noopener"' if ext else ''}>{label} <span aria-hidden="true">↗</span></a></div>'''
        dbody = page_header([('Events', 'events.html'), (e['title'], event_file(e))], f"{e['kind']} · {'Upcoming' if e['upcoming'] else 'Past'}", e['title'], e['desc']) + f'''

<div id="event" class="py-10 lg:py-14" data-studio-event-rev="{e.get('revision', '')}">
  <div class="wrap evd-layout">
    <div class="evd-main min-w-0">{main}
      {placeholder_note('Sample event (lorem ipsum) to show the layout. Real event details will replace it.') if sample else ''}
    </div>
    {card}
  </div>
</div>

<section id="more" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('More Events', 'Other upcoming <span class="sh-soft">events.</span>', ('All events', 'events.html'))}
    <ul class="ev-list mt-8 lg:mt-10">{orows}
    </ul>
  </div>
</section>
''' + cta_band('Questions about this event?', 'Our team can help with registration, access or anything else before the day.',
                   ('Contact us', 'contact.html?topic=General+question#message'), ('All events', 'events.html')) + bar
        page(event_file(e), f"{e.get('seoTitle') or e['title']} · Events · AFCD Foundation", (e.get('seoDescription') or f"{e['kind']} on {e['day']} {e['mon']} {e['year']} in {e['where']}: {e['desc']}")[:160], 'events', dbody, parent=('Events', 'events.html'))

    page('events.html', 'Events · AFCD Foundation',
         'AFCD Foundation events: workshops, trainings, community days and online sessions across Morocco.', 'events', body)


# ---------------------------------------------------------------- Partners
PARTNERS = [
    ('International', ['World Denver', 'Danish Youth Council', 'Embassy of Switzerland in Morocco', 'U.S. Embassy Morocco', 'Embassy of France in Morocco', 'Service Civil International (Germany)', 'Plugged In Band Program', 'Rebild Ungdomsskole', 'MapWorks Learning']),
    ('National', ['High Atlas Foundation', 'Heinrich Böll Stiftung Rabat', 'Moroccan Institute for Policy Analysis', 'Dar America Casablanca', 'Anoual Association', 'International Youth Council Morocco', 'Student Voice', 'Y-PEER PETRI Morocco']),
    ('Local', ['Commune of Ait Ourir']),
]
# Studio loader (owned by AFCD Studio): when src/data/partners.json exists it replaces PARTNERS (same shape)
# and fills PARTNER_DETAILS {name: {slug, scope, category, description, url, logo, since, current, projects}}.
# All values in the file are already HTML-escaped by Studio; logo is a media ref for media_img() or None.
_PARTNERS_FILE = Path(os.environ.get('STUDIO_PARTNERS_JSON') or Path(__file__).parent / 'data' / 'partners.json')
PARTNER_DETAILS = {}
PARTNERS_REV = ''
if _PARTNERS_FILE.exists():
    import json as _pj
    _pd = _pj.loads(_PARTNERS_FILE.read_text(encoding='utf-8'))
    PARTNERS = [(_g, _n) for _g, _n in ((g, [x['name'] for x in _pd['partners'] if x['scope'] == g]) for g in ('International', 'National', 'Local')) if _n]
    PARTNER_DETAILS = {x['name']: x for x in _pd['partners']}
    PARTNERS_REV = _pd.get('revision', '')
# End of Studio loader.
PT_ICONS = {
    'International': '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3Z"/>',
    'National': '<path d="M10 17s5-4.6 5-9a5 5 0 0 0-10 0c0 4.4 5 9 5 9Z"/><circle cx="10" cy="8" r="1.8"/>',
    'Local': '<path d="M3.5 9 10 3.5 16.5 9v7.5h-13V9Z"/><path d="M8 16.5v-4h4v4"/>',
    'fund': '<rect x="2.5" y="5" width="15" height="10" rx="2"/><circle cx="10" cy="10" r="2.2"/><path d="M5.5 8v4M14.5 8v4"/>',
    'design': '<path d="m3 10 3-3 3 2 2-2 3 3"/><path d="M3 10l4 4 1.5-1M17 10l-4 4-3-2.5"/>',
    'share': '<circle cx="7" cy="7" r="2.5"/><circle cx="13.5" cy="8.5" r="2"/><path d="M2.5 16c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3M12 13c1.9-.4 3.8.8 4.5 3"/>',
}


def partners():
    def ico(k, cls=''):
        return f'<svg class="{cls}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{PT_ICONS[k]}</svg>'
    total = sum(len(n) for _g, n in PARTNERS)
    stats = f'<div class="pr-stat pr-stat-main"><dt>Partners</dt><dd>{total}</dd></div>' + ''.join(
        f'<div class="pr-stat"><dt>{ico(g, "pr-stat-ico")}{g}</dt><dd>{len(n)}</dd></div>' for g, n in PARTNERS)
    chips = '<button type="button" class="nw-chip" data-pf="all" aria-pressed="true">All <span class="pr-count">' + str(total) + '</span></button>' + ''.join(
        f'<button type="button" class="nw-chip" data-pf="{g}" aria-pressed="false">{g} <span class="pr-count">{len(n)}</span></button>' for g, n in PARTNERS)
    def initials(name):
        w = [x for x in name.replace('(', '').replace(')', '').split() if x[0].isalpha() and x.lower() not in ('of', 'in', 'for', 'the', 'and')]
        return ''.join(x[0] for x in w[:2]).upper()
    cards = ''.join(f'''
      <li class="pr-card" data-group="{g}" data-name="{n.lower()}">
        <span class="pr-logo" aria-hidden="true"><span>{initials(n)}</span></span>
        <span class="mt-5 block text-[16px] font-semibold leading-snug tracking-[-0.015em]">{n}</span>
        <span class="pr-scope">{ico(g)}{g}</span>
      </li>''' for g, names in PARTNERS for n in names)
    models = [('fund', 'Fund', 'Support a programme under one of our four pillars, from a single cohort to multi-year work.'),
              ('design', 'Co-design', 'Build an initiative with AFCD and the community, from the first idea to the final report.'),
              ('share', 'Share expertise', 'Train, mentor or host participants, and bring your organisation’s know-how to a programme.')]
    mhtml = ''.join(f'<li class="wd-card" style="--c:#F3F3F3"><span class="flex items-start justify-between"><span class="wd-ico">{ico(k)}</span><span class="wd-n">{i:02d}</span></span><span class="mt-8 block text-[20px] font-semibold tracking-[-0.025em]">{t}</span><span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{d}</span></li>' for i, (k, t, d) in enumerate(models, 1))
    steps = [('Tell us about your organisation', 'Share your goals and the communities or pillar you’d like to support.'),
             ('Explore the fit together', 'We look at how your goals connect with our four pillars and current programmes.'),
             ('Co-design and launch', 'We agree the plan, launch the work together and report on what it achieves.')]
    shtml = ''.join(f'<li class="os-step"><span class="os-step-k">{i:02d}</span><span class="os-step-dot" aria-hidden="true"></span><span class="mt-5 block text-[20px] font-semibold tracking-[-0.025em]">{t}</span><span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{d}</span></li>' for i, (t, d) in enumerate(steps, 1))

    body = page_header([('Partners', 'partners.html')], 'Our Partners',
                       'Stronger <span class="text-ink-mid">together.</span>',
                       'International, national and local organizations that have supported AFCD’s programmes, as listed on the current Our Partners page.') + f'''

<section id="overview" class="pt-8 lg:pt-10">
  <div class="wrap">
    <dl class="pr-stats">{stats}</dl>
  </div>
</section>

<section id="directory" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / Partner Directory', 'Organisations <span class="sh-soft">we work with.</span>', f'{total} partners', desc='Filter by scope or search by name. Logos will be added once each partner approves their use.')}
    <div class="pr-tools mt-8">
      <div class="nw-chips" role="group" aria-label="Filter partners">{chips}</div>
      <label class="pr-search"><span class="sr-only">Search partners</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.3 3.3"/></svg><input id="partner-search" type="search" placeholder="Search partners" autocomplete="off"></label>
    </div>
    <ul id="partner-grid" class="pr-grid mt-6">{cards}
    </ul>
    <p class="pr-empty mt-6 hidden text-[15px] text-ink-mid" role="status">No partners match your search.</p>
    {placeholder_note('Logos to be added. AFCD will confirm which partnerships are current.')}
  </div>
</section>

<section id="models" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / Ways to Partner', 'Co-design <span class="sh-soft">change with us.</span>', 'Three models', desc='Every partnership is shaped around shared goals and the communities we serve.')}
    <ul class="mt-8 grid gap-3 md:grid-cols-3 lg:mt-10">{mhtml}</ul>
  </div>
</section>

<section id="how" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('03 / How It Starts', 'From first message <span class="sh-soft">to shared results.</span>', 'Three steps')}
    <ol class="os-steps gi-journey mt-8 lg:mt-10">{shtml}
    </ol>
  </div>
</section>
''' + cta_band('Let’s build something together.', 'Tell us about your organization and what you would like to support.',
               ('Partner With Us', 'contact.html?topic=Partnership#message'), ('Our projects', 'projects.html'))
    page('partners.html', 'Partners · AFCD Foundation',
         'The international, national and local organizations that have supported AFCD Foundation’s programmes.', 'partners', body)


# ---------------------------------------------------------------- Get Involved
GI_ICONS = {
    'volunteer': '<path d="M10 16.5s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.9 3.3 3.3 0 0 1 6 1.9c0 4.4-6 8-6 8Z"/>',
    'programs': '<path d="M2.5 7 10 4l7.5 3L10 10 2.5 7Z"/><path d="M5.5 8.3v3.7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V8.3"/>',
    'partner': '<path d="m3 10 3-3 3 2 2-2 3 3"/><path d="M3 10l4 4 1.5-1M17 10l-4 4-3-2.5"/>',
    'alumni': '<circle cx="7" cy="7" r="2.5"/><circle cx="13.5" cy="8.5" r="2"/><path d="M2.5 16c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3M12 13c1.9-.4 3.8.8 4.5 3"/>',
}


def involved():
    ways = [
        dict(id='volunteer', n='01', tone='#FFB2B9', t='Volunteer', topic='Volunteering',
             d='Give time to activities in Ait Ourir and beyond, alongside AFCD’s team and participants.',
             who='Students, professionals and community members who want to help locally.',
             items=['Help run workshops and community days', 'Support events and awareness campaigns', 'Bring your skills to a programme'],
             steps=['Tell us where you are and what you’d like to do', 'We match you with an activity or event', 'Join the team on the day'],
             cta='Become a volunteer'),
        dict(id='programs', n='02', tone='#A8DDFB', t='Join a Programme', topic='Joining a programme',
             d='Apply when calls open for youth and women’s programmes in leadership, environment and digital skills.',
             who='Young people and women; criteria vary by programme and call.',
             items=['Leadership and entrepreneurship tracks', 'Environmental and climate projects', 'Digital skills workshops'],
             steps=['Watch News &amp; Stories for open calls', 'Apply following the call’s instructions', 'Take part and lead your own initiative'],
             cta='Ask about open calls'),
        dict(id='partner', n='03', tone='#82E591', t='Partner With Us', topic='Partnership',
             d='Co-design and fund community initiatives with an organisation rooted in Moroccan communities since 2007.',
             who='International, national and local organisations, institutions and companies.',
             items=['Fund a programme or a pillar', 'Co-design an initiative', 'Share expertise and mentoring'],
             steps=['Tell us about your organisation and goals', 'We explore fit with our four pillars together', 'Co-design, launch and report on the work'],
             cta='Start a partnership'),
        dict(id='alumni', n='04', tone='#FBE38A', t='Alumni Club', topic='Alumni club',
             d='Stay connected with fellow alumni of AFCD programmes and keep the change going.',
             who='Past participants of AFCD programmes.',
             items=['Meet fellow alumni', 'Mentor new participants', 'Hear about new opportunities first'],
             steps=['Tell us your programme and year', 'We reconnect you with the alumni network', 'Mentor, meet and take part'],
             cta='Join the alumni club'),
    ]
    def ico(k):
        return f'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{GI_ICONS[k]}</svg>'
    tabs = ''.join(f'''<button type="button" class="gi-tab" role="tab" id="tab-{w['id']}" aria-controls="{w['id']}" aria-selected="{'true' if i == 0 else 'false'}" style="--c:{w['tone']}"><span class="gi-tab-ico">{ico(w['id'])}</span><span class="min-w-0 flex-1 text-left"><span class="block text-[11px] font-medium tabular-nums text-ink-mid">{w['n']}</span><span class="block text-[17px] font-semibold tracking-[-0.02em]">{w['t']}</span></span><span class="gi-tab-arr" aria-hidden="true">→</span></button>''' for i, w in enumerate(ways))
    check = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5"/></svg>'
    panels = ''.join(f'''
      <article id="{w['id']}" class="gi-panel scroll-mt-32" role="tabpanel" aria-labelledby="tab-{w['id']}" style="--c:{w['tone']}">
        <div class="gi-panel-top">
          <span class="gi-panel-ico">{ico(w['id'])}</span>
          <span class="pl-hero-n">{w['n']}<span class="text-black/40"> / 04</span></span>
        </div>
        <h2 class="mt-6 text-[34px] font-semibold leading-[1.02] tracking-[-0.045em] md:text-[48px]">{w['t']}</h2>
        <p class="mt-4 max-w-[52ch] text-[16.5px] leading-relaxed text-black/75">{w['d']}</p>
        <div class="mt-8 grid gap-3 md:grid-cols-2">
          <div class="gi-box"><p class="label text-ink-mid">What you’ll do</p><ul class="mt-4 grid gap-2.5">{''.join(f'<li class="gi-check">{check}<span>{x}</span></li>' for x in w['items'])}</ul></div>
          <div class="gi-box"><p class="label text-ink-mid">How it works</p><ol class="mt-4 grid gap-2.5">{''.join(f'<li class="gi-stepline"><span class="gi-stepline-n">{k}</span><span>{x}</span></li>' for k, x in enumerate(w['steps'], 1))}</ol></div>
        </div>
        <div class="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p class="max-w-[46ch] text-[14px] leading-relaxed text-black/65"><b class="font-semibold text-black">Who it’s for:</b> {w['who']}</p>
          <a href="contact.html?topic={w['topic'].replace(' ', '+')}#message" class="btn-dark btn-cta min-h-[50px] px-7">{w['cta']} {ARR}</a>
        </div>
      </article>''' for w in ways)
    journey = [('Choose your path', 'Volunteer, join a programme, partner with us or reconnect as an alumnus.'),
               ('Get in touch', 'Send us a message with the right topic, and it goes straight to the right team.'),
               ('Take part', 'We follow up with next steps, and you join AFCD’s community in action.')]
    jhtml = ''.join(f'<li class="os-step"><span class="os-step-k">{i:02d}</span><span class="os-step-dot" aria-hidden="true"></span><span class="mt-5 block text-[20px] font-semibold tracking-[-0.025em]">{t}</span><span class="mt-2 block text-[14.5px] leading-relaxed text-ink-dark">{d}</span></li>' for i, (t, d) in enumerate(journey, 1))

    body = page_header([('Get Involved', 'get-involved.html')], 'Get Involved',
                       'Let’s create change <span class="text-ink-mid">together.</span>',
                       'Join our community, explore opportunities or collaborate with AFCD Foundation to create meaningful and lasting impact.') + f'''

<section id="paths" class="pt-8 lg:pt-10">
  <div class="wrap">
    <div class="gi-shell">
      <div class="gi-side">
        <p class="label text-ink-mid">Choose your path</p>
        <div class="gi-tabs mt-4" role="tablist" aria-label="Ways to get involved">{tabs}</div>
        <div class="gi-side-note">
          <p class="text-[14px] font-semibold">Not sure where you fit?</p>
          <p class="mt-1 text-[13.5px] leading-relaxed text-ink-dark">Write to us and we’ll suggest the right way to take part.</p>
          <a href="contact.html#message" class="link-arrow mt-3 text-[13.5px]">Send a message {ARR}</a>
        </div>
      </div>
      <div class="gi-panels">{panels}
      </div>
    </div>
  </div>
</section>

<section id="how" class="py-14 lg:py-16">
  <div class="wrap">{sec_head('01 / How It Works', 'Three steps <span class="sh-soft">to take part.</span>', 'Simple and personal', desc='Whichever path you choose, getting started looks the same.')}
    <ol class="os-steps gi-journey mt-8 lg:mt-10">{jhtml}
    </ol>
  </div>
</section>

<section id="calls" class="pb-6 lg:pb-8">
  <div class="wrap">
    <a href="news.html" class="gi-calls group">
      <span class="cta-kicker" style="background:#fff;color:#000"><span class="tb-dot" aria-hidden="true"></span>Open calls</span>
      <span class="mt-6 block text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[44px]">Looking for the next call <span class="text-white/45">for applications?</span></span>
      <span class="mt-4 block max-w-[52ch] text-[15.5px] leading-relaxed text-white/65">Calls for youth and women’s programmes are published on News &amp; Stories and in our newsletter.</span>
      <span class="btn-light btn-cta mt-8 min-h-[48px] px-6 text-[14px]">See News &amp; Stories {ARR}</span>
    </a>
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
      <div class="flex flex-wrap items-center justify-between gap-3"><div class="sh-top min-w-0 flex-1"><span class="sh-num">01</span><span class="sh-label">Send a message</span><span class="sh-rule" aria-hidden="true"></span></div><span class="ct-status" data-forms-off><span class="ct-status-dot" aria-hidden="true"></span>Preview form</span></div>
      <h2 class="mt-5 text-[26px] font-semibold leading-[1.05] tracking-[-0.04em] md:text-[32px]">How can <span class="text-ink-mid">we help?</span></h2>

      <fieldset class="ct-step mt-6">
        <legend class="ct-step-h"><span class="ct-step-n">1</span>What is it about?</legend>
        <div class="ct-dd mt-3"><button type="button" class="ct-dd-btn" aria-haspopup="true" aria-expanded="false" aria-controls="ct-dd-menu"><span class="ct-dd-cur"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14.2v.1"/></svg>General question</span><svg class="ct-dd-chev" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 8 4.5 4.5L14.5 8"/></svg></button><div id="ct-dd-menu" class="ct-dd-menu" role="radiogroup" aria-label="Topic" hidden><label class="ct-opt"><input type="radio" name="topic" value="General question" data-hint="Ask us anything about AFCD and our work." data-to="contact@afcdteam.com" checked><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M10 14.2v.1"/></svg>General question</span></label><label class="ct-opt"><input type="radio" name="topic" value="Volunteering" data-hint="Tell us where you are based and how you’d like to help." data-to="contact@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 16.5s-6-3.6-6-8a3.3 3.3 0 0 1 6-1.9 3.3 3.3 0 0 1 6 1.9c0 4.4-6 8-6 8Z"/></svg>Volunteering</span></label><label class="ct-opt"><input type="radio" name="topic" value="Joining a programme" data-hint="Mention the programme or call you’re interested in." data-to="contact@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7 10 4l7.5 3L10 10 2.5 7Z"/><path d="M5.5 8.3v3.7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V8.3"/></svg>Joining a programme</span></label><label class="ct-opt"><input type="radio" name="topic" value="Partnership" data-hint="Tell us about your organisation and the pillar you’d like to support." data-to="contact@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 3-3 3 2 2-2 3 3"/><path d="M3 10l4 4 1.5-1M17 10l-4 4-3-2.5"/></svg>Partnership</span></label><label class="ct-opt"><input type="radio" name="topic" value="Alumni club" data-hint="Share your programme and year so we can reconnect you." data-to="contact@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="2.5"/><circle cx="13.5" cy="8.5" r="2"/><path d="M2.5 16c.6-2.8 2.4-4.3 4.5-4.3s3.9 1.5 4.5 4.3M12 13c1.9-.4 3.8.8 4.5 3"/></svg>Alumni club</span></label><label class="ct-opt"><input type="radio" name="topic" value="Press" data-hint="Include your outlet and deadline." data-to="contact@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="11" height="12" rx="1.5"/><path d="M14 7h2.5v7.5a1.5 1.5 0 0 1-3 0M6 7.5h5M6 10.5h5M6 13.5h3"/></svg>Press</span></label><label class="ct-opt"><input type="radio" name="topic" value="Board &amp; governance" data-hint="Questions for AFCD’s board leadership." data-to="akaya@afcdteam.com"><span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5 3 6v1.5h14V6L10 2.5Z"/><path d="M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M2.5 16.5h15"/></svg>Board &amp; governance</span></label></div></div>
        <div class="ct-hint mt-2" aria-live="polite"><span class="ct-hint-ic" aria-hidden="true">i</span><span class="min-w-0 flex-1"><span class="ct-hint-t block">Ask us anything about AFCD and our work.</span><span class="mt-0.5 block text-[12.5px] text-ink-mid">Goes to <b class="ct-hint-to font-medium text-ink-pure">contact@afcdteam.com</b></span></span></div>
      </fieldset>

      <fieldset class="ct-step mt-6">
        <legend class="ct-step-h"><span class="ct-step-n">2</span>Your details</legend>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <label class="ct-field"><span>Full name</span><span class="ct-in"><svg class="ct-fi" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="7" r="3"/><path d="M4 16.5c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6"/></svg><input name="name" type="text" maxlength="120" autocomplete="name" placeholder="Your name" required></span></label>
          <label class="ct-field"><span>Email</span><span class="ct-in"><svg class="ct-fi" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="m3.5 6 6.5 4.5L16.5 6"/></svg><input name="email" type="email" maxlength="160" autocomplete="email" placeholder="you@example.com" required></span></label>
          <label class="ct-field"><span>Phone <em>optional</em></span><span class="ct-in"><svg class="ct-fi" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.5h3l1.5 3.7-2 1.2a10 10 0 0 0 6.1 6.1l1.2-2 3.7 1.5v3a1.7 1.7 0 0 1-1.8 1.7C8.4 17.2 2.8 11.6 2.3 4.3A1.7 1.7 0 0 1 4 2.5Z"/></svg><input name="phone" type="tel" maxlength="40" autocomplete="tel" placeholder="+212 …"></span></label>
          <label class="ct-field"><span>Organisation <em>optional</em></span><span class="ct-in"><svg class="ct-fi" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3" width="9" height="14" rx="1"/><path d="M12.5 8h4v9h-4M6.5 6.5h3M6.5 9.5h3M6.5 12.5h3"/></svg><input name="org" type="text" maxlength="160" autocomplete="organization" placeholder="School, association, company…"></span></label>
        </div>
      </fieldset>

      <fieldset class="ct-step mt-6">
        <legend class="ct-step-h"><span class="ct-step-n">3</span>Your message</legend>
        <label class="ct-field mt-3"><span class="sr-only">Message</span><textarea name="message" rows="4" maxlength="1000" placeholder="Write your message…" required></textarea></label>
        <div class="mt-2 flex items-start justify-between gap-4"><label class="ct-consent"><input type="checkbox" name="consent" required><span>I agree that AFCD Foundation may use these details to reply to my message. See our <a href="#privacy" class="underline underline-offset-2">Privacy Policy</a>.</span></label><span class="shrink-0 pt-0.5 text-[12px] text-ink-mid"><span class="ct-count">0</span> / 1000</span></div>
      </fieldset>

      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
      <p class="form-error mt-5 hidden rounded-2xl bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]" role="alert">Please add your name, a valid email, a message and your consent.</p>
      <div class="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-ink-light pt-5">
        <p class="max-w-[40ch] text-[12.5px] leading-relaxed text-ink-mid" data-forms-off>This form isn’t connected yet, so nothing is sent. For now, please email the address shown above.</p><p class="max-w-[40ch] text-[12.5px] leading-relaxed text-ink-mid" data-forms-on hidden>Your message goes straight to the AFCD team inbox.</p>
        <button type="submit" class="btn-dark btn-cta min-h-[52px] px-7">Send message <span class="arr" aria-hidden="true">↗</span></button>
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
         'Contact AFCD Foundation: main office in Marrakech, Morocco. Email contact@afcdteam.com or call +212 663 618 536.', 'contact', studio_contact_fields(body))


def studio_contact_fields(s):
    """AFCD Studio edits the contact page's text: data-sf markers (see lib/page-fields.mjs and Studio's Contact page editor).
    build.mjs always removes them, so the built page is unchanged until an edit is reviewed and published. Each marker
    is placed on text written above; a missing one stops the run, so a wording change here cannot silently drop a field."""
    def r(old, new):
        nonlocal s
        if s.count(old) != 1:
            raise SystemExit(f'contact.html: Studio field anchor not found once: {old[:70]}')
        s = s.replace(old, new)
    r('<h1 class="sh-title sh-xl phd-title">', '<h1 class="sh-title sh-xl phd-title" data-sf="head.title" data-sf-type="split">')
    r('<p class="phd-lead">', '<p class="phd-lead" data-sf="head.lead">')
    lab = '<span class="mt-6 block text-[12px] font-medium uppercase tracking-[0.16em] text-ink-mid">'
    val = '<span class="mt-2 block break-words text-[19px] font-semibold tracking-[-0.02em]">'
    lab_k = lambda k: lab.replace('">', f'" data-sf="{k}">')
    val_k = lambda k: val.replace('">', f'" data-sf="{k}">')
    for href, key, kind, title in (('tel:+212663618536', 'reach.phone', 'tel', 'Call us'), ('mailto:contact@afcdteam.com', 'reach.email1', 'mailto', 'Executive team'),
                                   ('mailto:akaya@afcdteam.com', 'reach.email2', 'mailto', 'Board leadership')):
        r(f'<a href="{href}" class="ct-q group">', f'<a href="{href}" class="ct-q group" data-sf="{key}" data-sf-type="{kind}">')
        r(lab + title + '</span>' + val, lab_k(key + '.label') + title + '</span>' + val_k(key))
    r(lab + 'Main office</span>' + val, lab_k('reach.office.label') + 'Main office</span>' + val_k('reach.office'))
    r('<span class="sh-num">01</span><span class="sh-label">Send a message</span>', '<span class="sh-num" data-sf="message.head.num">01</span><span class="sh-label" data-sf="message.head.label">Send a message</span>')
    r('md:text-[32px]">How can', 'md:text-[32px]" data-sf="message.title" data-sf-type="split">How can')
    r('tracking-[-0.04em]">Marrakech,', 'tracking-[-0.04em]" data-sf="message.office.title" data-sf-type="split">Marrakech,')
    r('text-white/65">Roots', 'text-white/65" data-sf="message.office.text">Roots')
    for i, (topic, email) in enumerate((('Volunteering, programmes &amp; alumni', 'contact@afcdteam.com'), ('Partnerships &amp; press', 'contact@afcdteam.com'), ('Board &amp; governance', 'akaya@afcdteam.com')), 1):
        r(f'<span class="text-[14.5px] text-white/80">{topic}</span><a class="text-[14px] font-medium hover:underline" href="mailto:{email}">',
          f'<span class="text-[14.5px] text-white/80" data-sf="message.to{i}.label">{topic}</span><a class="text-[14px] font-medium hover:underline" href="mailto:{email}" data-sf="message.to{i}.email" data-sf-type="email">')
    r('<span class="sh-num">02</span><span class="sh-label">Questions</span>', '<span class="sh-num" data-sf="faq.head.num">02</span><span class="sh-label" data-sf="faq.head.label">Questions</span>')
    r('<h2 class="sh-title reveal">Before you', '<h2 class="sh-title reveal" data-sf="faq.title" data-sf-type="split">Before you')
    n = [0]
    def faq(m):
        n[0] += 1; i = n[0]; x = m.group(0)
        x = x.replace('<summary><span>', f'<summary><span data-sf="faq.q{i}">', 1)
        x = x.replace('<div class="ct-faq-a"><p>', f'<div class="ct-faq-a"><p data-sf="faq.a{i}">', 1)
        return x.replace('<a class="link-arrow mt-4"', f'<a class="link-arrow mt-4" data-sf="faq.link{i}" data-sf-type="link"', 1)
    s = re.sub(r'<details class="ct-faq".*?</details>', faq, s, flags=re.S)
    if n[0] != 4:
        raise SystemExit('contact.html: expected 4 questions for Studio fields')
    r('text-ink-dark">We aim', 'text-ink-dark" data-sf="policy.access">We aim')
    return s


if __name__ == '__main__':
    about(); pillars(); projects(); project_details(); news(); news_articles(); events(); partners(); involved(); contact()
    print('pages written to', OUT)
