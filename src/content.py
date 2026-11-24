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

# Pillar content (owned by AFCD Studio): src/data/pillars.json, or env STUDIO_PILLARS_JSON, replaces the pillar texts in
# this file once they are managed in Studio (Content > Pillars). Studio sends every value HTML-escaped. Without the file
# the pages build exactly as written here. Keys, numbers and page files never change, so URLs stay the same.
_PILLARS_JSON = Path(os.environ.get('STUDIO_PILLARS_JSON') or Path(__file__).parent / 'data' / 'pillars.json')
STUDIO_PILLARS = __import__('json').loads(_PILLARS_JSON.read_text(encoding='utf-8'))['pillars'] if _PILLARS_JSON.is_file() else []
STUDIO_PILLAR_BY_KEY = {p_['key']: p_ for p_ in STUDIO_PILLARS}   # per-pillar extras, e.g. 'objectives': [{title, text}]
if STUDIO_PILLARS:
    PILLARS = [(p['key'], p['number'], p['name'], p['summary'], p['highlights']) for p in STUDIO_PILLARS]
    _names = {p['key']: p['name'] for p in STUDIO_PILLARS}
    OBJECTIVES = [(r, t, d, [(_names.get(sl, n), sl) for n, sl in links]) for r, t, d, links in OBJECTIVES]
# How many pillars there are, for "Pillar 02 / 04" and "Four pillars" (Studio can add and remove pillars).
PILLAR_COUNT = len(PILLARS)
PILLARS_TOTAL = f'{PILLAR_COUNT:02d}'
PILLARS_WORD = (['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][PILLAR_COUNT]
                if PILLAR_COUNT <= 12 else str(PILLAR_COUNT))
PILLARS_WORD_CAP = PILLARS_WORD[:1].upper() + PILLARS_WORD[1:]

# name, pillar slug, pillar name, category, detail page (or None), one-line summary
# Project data lives in src/data/projects.json (managed by AFCD Studio). STUDIO_PROJECTS_JSON can point elsewhere for previews.
import json as _json
_PROJECTS_FILE = Path(os.environ.get('STUDIO_PROJECTS_JSON') or Path(__file__).parent / 'data' / 'projects.json')
_PROJECT_DATA = _json.loads(_PROJECTS_FILE.read_text(encoding='utf-8'))['projects']
_PILLAR_NAMES = {'youth-empowerment': 'Youth Empowerment', 'women-empowerment': 'Women’s Empowerment',
                 'green-thumbs': 'Environment and Climate', 'digital-empowerment': 'Digital Inclusion and Innovation'}
_PILLAR_NAMES.update({p['key']: p['name'] for p in STUDIO_PILLARS})
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
if STUDIO_PILLARS:   # Studio pillars bring their own page file (<key>.html for pillars added in Studio)
    PILLAR_FILE = {p['key']: p['file'] for p in STUDIO_PILLARS}


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



# Social sharing: static links to the production page (scripts swap in the current language's canonical URL).
_SHARE_ICO = {
    'facebook': '<path d="M11.2 18v-6.2h2.1l.3-2.4h-2.4V7.9c0-.7.2-1.2 1.2-1.2h1.3V4.6a17 17 0 0 0-1.9-.1c-1.9 0-3.2 1.2-3.2 3.3v1.8H6.5v2.4h2.1V18h2.6Z" fill="currentColor"/>',
    'linkedin': '<path d="M5.2 7.6h2.6V16H5.2V7.6Zm1.3-4.1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9.4 7.6h2.5v1.2c.4-.7 1.2-1.4 2.6-1.4 2.7 0 3.2 1.8 3.2 4.1V16h-2.6v-4c0-1 0-2.2-1.3-2.2-1.4 0-1.6 1-1.6 2.1V16H9.4V7.6Z" fill="currentColor"/>',
    'x': '<path d="M13.9 4h2.3l-5 5.7L17 16h-4.6l-3.6-4.7L4.7 16H2.4l5.3-6.1L2.2 4h4.7l3.3 4.3L13.9 4Zm-.8 10.7h1.3L6.2 5.3H4.8l8.3 9.4Z" fill="currentColor"/>',
    'whatsapp': '<path d="M10 2.5a7.4 7.4 0 0 0-6.4 11.2l-1 3.8 3.9-1A7.4 7.4 0 1 0 10 2.5Zm0 13.5c-1.1 0-2.2-.3-3.2-.9l-.2-.1-2.3.6.6-2.2-.2-.2A6.1 6.1 0 1 1 10 16Zm3.4-4.6c-.2-.1-1.1-.5-1.2-.6-.2-.1-.3-.1-.4.1l-.6.7c-.1.1-.2.1-.4 0-.2-.1-.8-.3-1.5-.9-.5-.5-.9-1.1-1-1.2-.1-.2 0-.3.1-.4l.3-.3.2-.3v-.3l-.6-1.3c-.1-.3-.3-.3-.4-.3h-.3c-.1 0-.3 0-.5.2s-.6.6-.6 1.5.6 1.7.7 1.8c.1.1 1.2 1.9 3 2.6 1.5.6 1.8.5 2.1.4.3 0 1.1-.4 1.2-.9.2-.4.2-.8.1-.9l-.3-.2Z" fill="currentColor"/>',
    'link': '<path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-.8.8M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l.8-.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    'more': '<path d="M10 3v9M6.5 6.5 10 3l3.5 3.5M4.5 10.5v4A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
}


def share_bar(file, title, label='Share', extra=''):
    from urllib.parse import quote
    import html as _h
    t = _h.unescape(re.sub(r'<[^>]+>', '', title))
    u = quote('https://afcdfoundation.com/' + file, safe='')
    tt = quote(t, safe='')
    nets = [('facebook', 'Facebook', f'https://www.facebook.com/sharer/sharer.php?u={u}'),
            ('linkedin', 'LinkedIn', f'https://www.linkedin.com/sharing/share-offsite/?url={u}'),
            ('x', 'X', f'https://twitter.com/intent/tweet?url={u}&amp;text={tt}'),
            ('whatsapp', 'WhatsApp', f'https://wa.me/?text={tt}%20{u}')]
    ico = lambda k: f'<svg viewBox="0 0 20 20" aria-hidden="true">{_SHARE_ICO[k]}</svg>'
    links = ''.join(f'<a class="shr-b" data-net="{k}" href="{href}" target="_blank" rel="noopener" aria-label="Share on {name}" title="{name}">{ico(k)}</a>' for k, name, href in nets)
    return (f'<div class="shr{(" " + extra) if extra else ""}" data-shr><span class="shr-k">{label}</span><span class="shr-row">{links}'
            f'<button type="button" class="shr-b" data-copy-link aria-label="Copy link" title="Copy link">{ico("link")}</button>'
            f'<button type="button" class="shr-b" data-share hidden data-shr-native aria-label="More ways to share" title="More">{ico("more")}</button></span></div>')

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
# The About pages (Our Story, Mission & Vision, Strategy, Our Team) and the Partners page texts are managed in AFCD Studio
# (Content > About pages). Studio writes src/data/about.json (or env STUDIO_ABOUT_JSON) with one entry per published page,
# in PLAIN TEXT: this generator escapes every value itself. Without the file (or for a page not yet published from
# Studio) the pages use ABOUT_DEFAULTS below, which is also what Studio imports once. Nothing here is invented: the texts
# are the ones the website showed, plus the copy AFCD supplied for Our Story and Our Team.
import html as _html
_U = _html.unescape   # the literals elsewhere in this file are HTML; the About content is plain text

ABOUT_DEFAULTS = {
    'our-story': {
        'hero': {'title': 'It started with young volunteers', 'soft': 'in Ait Ourir.',
                 'lead': 'Founded in 2007 by committed young volunteers, AFCD Foundation grew from Ait Ourir into programmes across Morocco.'},
        'intro': 'Founded in 2007 by a group of passionate young people, AFCD Foundation began with a mission to build a sustainable future for Moroccan communities. What started as a local project has grown into a national platform for civic engagement and social transformation.',
        'paragraphs': [
            'AFCD Foundation is a Moroccan nonprofit association founded in 2007 that promotes sustainable development through youth and women’s empowerment, environmental education, civic participation, and digital inclusion.',
            'Rooted in Ait Ourir and the Al Haouz area, with its main office in Marrakech, AFCD works with young people, women, and local communities across Morocco.',
            'Through practical training, mentoring, community initiatives, and dialogue, AFCD helps people build skills and contribute to positive change in their communities.',
        ],
        'facts': [{'label': 'Founded', 'value': '2007'}, {'label': 'Roots', 'value': 'Ait Ourir, Al Haouz'}, {'label': 'Main office', 'value': 'Marrakech'}],
        'legalName': 'Association le Futur pour les Chantiers et le Développement',
        'foundedYear': 2007,
        'statement': {
            'kicker': 'Welcome to AFCD Foundation', 'title': 'AFCD Foundation: We Serve Our Community With Love',
            'paragraphs': [
                'AFCD is remarkably reputed locally, nationally, and internationally due to the fact that improving citizens’ lifestyles lies at the heart of most of our projects. Thus, we put much focus on education as it is considered the only key to emancipation. Youth and women’s empowerment issues top our agendas because AFCD considers both youths and women the backbone of society and their empowerment will bring about fruitful results.',
                'It’s really mesmerizing that recently a lot of ambitious and vigor youths have shown an inner desire to work with AFCD, which feeds our team year in and year out. Furthermore, the overwhelming majority of volunteers are young people who are intrinsically motivated to make their areas a safe haven where everyone learns, produces, and shares.',
            ],
            'name': 'AKAYA Kamal', 'role': 'President of AFCD Foundation', 'mediaId': None,
        },
        'milestones': [
            {'when': '2007', 'title': 'Founded', 'text': 'A group of young people committed to improving living conditions in their community founds AFCD.'},
            {'when': 'Roots', 'title': 'Ait Ourir & Al Haouz', 'text': 'Work rooted in Ait Ourir and the Al Haouz area expands through regional and national initiatives.'},
            {'when': '2020–21', 'title': 'Eco-Citizen & Youth First', 'text': 'Eco-Citizen, Youth First and Youth First Academy combine environmental awareness, youth mobilisation, leadership and active citizenship.'},
            {'when': '2022 →', 'title': 'Leadership Lab', 'text': 'Successive editions of Leadership Lab develop this work through training, mentoring, entrepreneurship and support for community initiatives.'},
        ],
        'principles': [
            {'title': 'Community-Rooted Leadership', 'text': 'Our programs are built and led by people from the communities we serve. This local ownership ensures that our work is grounded in reality.'},
            {'title': 'Inclusive & Participatory', 'text': 'We believe real impact happens when people are included from the start. AFCD engages youth, women, and civil society at every stage of our initiatives.'},
            {'title': 'Sustainable Impact', 'text': 'We don’t aim for quick wins. Our projects focus on long-term results—building skills, confidence, and resilience that last beyond the program timeline.'},
            {'title': 'Environmental & Digital Focus', 'text': 'AFCD bridges critical gaps in environmental education and digital access, helping communities respond to global challenges with local solutions.'},
            {'title': 'Transparent & Accountable', 'text': 'We are committed to ethical leadership and open communication. Transparency is central to our work, from budgeting to community reporting.'},
            {'title': 'Driven by Innovation', 'text': 'From youth-led climate solutions to community hackathons, AFCD embraces creativity to tackle the most urgent challenges of our time.'},
        ],
        'areas': [
            {'title': 'Youth Empowerment & Civic Engagement', 'pillar': 'youth-empowerment', 'text': 'We engage young people with pressing social issues and equip them with the tools and opportunities to realize their full potential. Our programs cultivate leadership skills, fostering a new generation of community leaders.'},
            {'title': 'Environmental Stewardship & Community Action', 'pillar': 'green-thumbs', 'text': 'We champion environmental awareness and protection, inspiring collective action to address local and global ecological challenges, including climate change. We bring people together to collaborate on effective, sustainable solutions for our planet, advocating for Nationally Determined Contributions (NDCs).'},
            {'title': 'Women’s Leadership & Mentorship', 'pillar': 'women-empowerment', 'text': 'We empower women by raising awareness about critical issues, offering direct guidance, and facilitating valuable network connections. Our goal is to build their capacities so they can become influential role models within their communities.'},
            {'title': 'Digital Inclusion & Knowledge Access', 'pillar': 'digital-empowerment', 'text': 'We empower youth by closing the digital divide, ensuring equitable access to information and vital knowledge. Our initiatives equip people with the digital literacy and technological understanding essential to thrive and seize opportunities in today’s interconnected world.'},
        ],
        'approach': {'title': 'With communities,', 'soft': 'not simply for communities.', 'steps': [
            {'title': 'Listen', 'text': 'Start from what communities in Ait Ourir and across Morocco say they need.'},
            {'title': 'Build capacity', 'text': 'Strengthen people’s skills through education, empowerment and innovation.'},
            {'title': 'Act together', 'text': 'Work with residents, institutions and partners so change lasts.'}]},
        'stats': [{'value': '2,700', 'label': 'Alumni of AFCD programs'}, {'value': '400', 'label': 'Ambassadors across Morocco'}, {'value': '24', 'label': 'Projects completed'}],
        'mediaId': None,
        'closing': {'title': 'Let’s create change together.', 'text': 'Whether you’re interested in partnering, volunteering, or learning more about our work—AFCD Foundation is here to connect.'},
    },
    'mission-vision': {
        'hero': {'title': 'What guides', 'soft': 'our work.', 'lead': 'A mission we act on every day, a vision we work toward, and four values that shape how we work.'},
        'mission': 'To promote sustainable development by strengthening the capacities of young people and women through environmental education, economic empowerment, and innovation.',
        'vision': 'A society free from exploitation and discrimination, where everyone has equal opportunities to grow, contribute, and realise their full potential.',
        'values': [{'title': t, 'text': d} for _n, t, d in VALUES],
        'closing': {'title': 'Let’s create change together.', 'text': 'Whether you’re interested in partnering, volunteering, or learning more about our work—AFCD Foundation is here to connect.'},
    },
    'strategy': {
        'hero': {'title': 'Six strategic', 'soft': 'objectives.', 'lead': 'The institutional objectives behind our programmes and reporting, and the people and places we serve.'},
        'objectivesIntro': f'Our institutional objectives guide programme design and reporting. They connect to our {PILLARS_WORD} pillars; they are not additional pillars.',
        'objectives': [{'ref': r, 'title': t, 'text': d, 'pillars': [s for _n, s in links]} for r, t, d, links in OBJECTIVES],
        'whoIntro': 'Age groups and participation criteria vary by programme; not every activity serves every group.',
        'summary': list(BENEFICIARY_SUMMARY),
        'regions': [{'name': r, 'places': c} for r, c in REGIONS],
        'coverage': COVERAGE_NOTE,
        'closing': {'title': 'Let’s create change together.', 'text': 'Whether you’re interested in partnering, volunteering, or learning more about our work—AFCD Foundation is here to connect.'},
    },
    'team': {
        'hero': {'title': 'The people who carry', 'soft': 'our work forward.', 'lead': 'The team, volunteers and alumni who run AFCD programmes in Marrakech, Al Haouz and across Morocco.'},
        'intro': 'At the heart of AFCD Foundation is a dynamic team united by passion, purpose, and innovation. Together, we transform ideas into action and challenges into opportunities, building a better future for all.',
        'people': [],
        'closing': {'title': 'Let’s create change together.', 'text': 'Whether you’re interested in partnering, volunteering, or learning more about our work—AFCD Foundation is here to connect.'},
    },
    'partners': {
        'hero': {'title': 'Stronger', 'soft': 'together.', 'lead': 'International, national and local organizations that have supported AFCD’s programmes, as listed on the current Our Partners page.'},
        'directoryIntro': 'Filter by scope or search by name.',
        'models': [{'title': 'Fund', 'text': f'Support a programme under one of our {PILLARS_WORD} pillars, from a single cohort to multi-year work.'},
                   {'title': 'Co-design', 'text': 'Build an initiative with AFCD and the community, from the first idea to the final report.'},
                   {'title': 'Share expertise', 'text': 'Train, mentor or host participants, and bring your organisation’s know-how to a programme.'}],
        'steps': [{'title': 'Tell us about your organisation', 'text': 'Share your goals and the communities or pillar you’d like to support.'},
                  {'title': 'Explore the fit together', 'text': f'We look at how your goals connect with our {PILLARS_WORD} pillars and current programmes.'},
                  {'title': 'Co-design and launch', 'text': 'We agree the plan, launch the work together and report on what it achieves.'}],
        'closing': {'title': 'Let’s build something together.', 'text': 'Tell us about your organization and what you would like to support.'},
    },
}
# Team groups, in the order the page shows them (Studio offers the same list).
TEAM_GROUPS = [('board', 'Board'), ('executive', 'Executive team'), ('staff', 'Staff'), ('volunteers', 'Volunteers & ambassadors')]

_ABOUT_JSON = Path(os.environ.get('STUDIO_ABOUT_JSON') or Path(__file__).parent / 'data' / 'about.json')
STUDIO_ABOUT = _json.loads(_ABOUT_JSON.read_text(encoding='utf-8')).get('pages', {}) if _ABOUT_JSON.is_file() else {}


def about_content(key):
    """The published Studio content of an About page, or the built-in text. Plain text: escape on output."""
    return STUDIO_ABOUT.get(key) or ABOUT_DEFAULTS[key]


# Strategic objectives published from Studio replace the built-in titles and texts everywhere on the site.
if STUDIO_ABOUT.get('strategy', {}).get('objectives'):
    _pn = {s: t for s, _n, t, _d, _r in PILLARS}
    OBJECTIVES = [(o['ref'], _esc(o['title']), _esc(o.get('text') or ''), [(_pn.get(s, s), s) for s in o.get('pillars') or [] if s in _pn])
                  for o in STUDIO_ABOUT['strategy']['objectives']]


def _rev(c):
    return f' data-studio-rev="{_esc(c["revision"])}"' if c.get('revision') else ''


def _title(h):
    """Hero title: main part, then the softer second part."""
    return _esc(h.get('title') or '') + (f' <span class="text-ink-mid">{_esc(h["soft"])}</span>' if h.get('soft') else '')


ABX_ICO = {
    'alumni': '<path d="M2.5 8 12 4l9.5 4-9.5 4-9.5-4Z"/><path d="M6.5 10v4.5c0 1.4 2.5 2.7 5.5 2.7s5.5-1.3 5.5-2.7V10M21.5 8v5"/>',
    'people': '<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M3 19c.7-3.3 2.9-5 5.5-5s4.8 1.7 5.5 5M14.2 15.2c.7-.5 1.5-.8 2.3-.8 2.1 0 3.8 1.5 4.4 4.1"/>',
    'projects': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M8 5V3.5M16 5V3.5M8 13.5l2.5 2.5 5-5"/>',
    'years': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
}


def abx_stats(c):
    """Impact numbers in one row: icon, big number, small spaced label. The years counter follows the founding year."""
    icons = ['alumni', 'people', 'projects']
    sup = lambda v: _esc(v[:-1]) + '<sup class="abx-plus">+</sup>' if v.endswith('+') else _esc(v)
    rows = [(icons[i] if i < len(icons) else 'projects', sup(s['value']), _esc(s['label'])) for i, s in enumerate(c.get('stats') or [])]
    fy = c.get('foundedYear')
    if fy:
        rows.append(('years', f'<span data-years-since>{__import__("datetime").date.today().year - int(fy)}</span>', f'Years of community work, since {int(fy)}'))
    ico = lambda k: f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ABX_ICO[k]}</svg>'
    return '<dl class="abx-stats">' + ''.join(f'<div class="abx-stat"><span class="abx-stat-ico">{ico(k)}</span><dd>{v}</dd><dt>{l}</dt></div>' for k, v, l in rows) + '</dl>'


def abx_nav(current):
    """The About pages as numbered pills inside the black overview (like the pillar switcher)."""
    return '<nav class="plx-pns" aria-label="About AFCD">' + ''.join(
        f'<a href="{f}" class="plx-pn{" is-on" if f == current else ""}" title="{t}"' + (' aria-current="page"' if f == current else '') + f'>{i:02d}</a>'
        for i, (f, t, _d) in enumerate(ABOUT_PAGES, 1)) + '</nav>'


def abx_overview(file, big, lead, facts, ctas, side='', share_title=''):
    facts_html = ''.join(f'<div class="plx-fact"><dt>{k}</dt><dd>{v}</dd></div>' for k, v in facts)
    links = ''.join((f'<a href="{h}" class="plx-btn">{t}</a>' if i == 0 else f'<a href="{h}" class="plx-link">{t}</a>') for i, (t, h) in enumerate(ctas))
    return f'''
<section id="overview" class="plx-sec pt-8 lg:pt-10">
  <div class="wrap">
    <div class="plx-hero{' has-side' if side else ''}">
      <div class="plx-hero-main">
        <div class="plx-hero-top">
          <span class="plx-big abx-big" aria-hidden="true">{big}</span>
          <div class="plx-hero-meta">{abx_nav(file) if any(f == file for f, _t, _d in ABOUT_PAGES) else ''}</div>
        </div>
        <p class="plx-lead abx-lead">{lead}</p>
        {f'<dl class="plx-facts">{facts_html}</dl>' if facts else ''}
        <div class="plx-cta">{links}</div>
        {share_bar(file, share_title, 'Share this page', 'plx-share')}
      </div>
      {side}
    </div>
  </div>
</section>'''


def abx_tabs(tabs):
    return f'''
<nav class="pl-tabs" aria-label="On this page" data-pl-tabs>
  <div class="wrap"><div class="pl-tabs-in">{''.join(f'<a href="#{a}" class="pl-tab">{b}</a>' for a, b in tabs)}</div></div>
</nav>'''


def abx_cta(c):
    cl = c.get('closing') or {}
    return cta_band(_esc(cl.get('title') or 'Let’s create change together.'), _esc(cl.get('text') or ''),
                    ('Get Involved', 'get-involved.html'), ('Partner With Us', 'get-involved.html#partner'))


def abx_rows(items, cls='abx-rows'):
    """Numbered list rows (title + text), the same rhythm as the pillar objectives."""
    return f'<ol class="plx-objs {cls}">' + ''.join(
        f'<li class="plx-obj"><span class="plx-obj-n">{j:02d}</span><span class="min-w-0"><span class="plx-obj-t">{_esc(x["title"])}</span>'
        + (f'<span class="plx-obj-d">{_esc(x["text"])}</span>' if (x.get('text') or '').strip() else '') + '</span></li>'
        for j, x in enumerate(items, 1)) + '</ol>'


def about():
    ABOUT = ('About Us', 'about.html')
    num = lambda: iter(range(1, 20))

    # ---------------------------------------------------------------- Our Story
    c = about_content('our-story')
    n = num()
    photo = c.get('image')
    paras = ''.join(f'<p>{_esc(p)}</p>' for p in c.get('paragraphs') or [])
    legal = f'<div class="abx-legal"><p class="plx-k">Legal name</p><p class="abx-legal-v">{_esc(c["legalName"])}</p></div>' if c.get('legalName') else ''
    side = (f'<figure class="plx-photo">{media_img(photo, "h-full w-full", "(min-width: 1024px) 40vw, 100vw", eager=True)}</figure>' if photo else
            f'<div class="plx-side abx-side"><p class="plx-k">In short</p><div class="abx-paras">{paras}</div>{legal}</div>' if paras or legal else '')
    facts = [(_esc(f['label']), _esc(f['value'])) for f in c.get('facts') or []] + [('Pillars', f'{PILLAR_COUNT:02d}')]
    tl = ''.join(f'''<li class="abx-tl-i"><span class="abx-tl-when">{_esc(m["when"])}</span><span class="abx-tl-dot" aria-hidden="true"></span><span class="abx-tl-b"><span class="abx-tl-t">{_esc(m["title"])}</span>{f'<span class="abx-tl-d">{_esc(m["text"])}</span>' if (m.get("text") or "").strip() else ''}</span></li>'''
                 for m in c.get('milestones') or [])
    pr = c.get('principles') or []
    areas = c.get('areas') or []
    area_rows = ''.join(
        (f'<li><a href="pillars.html#{_esc(a["pillar"])}" class="plx-other abx-area">' if a.get('pillar') in PILLAR_FILE else '<li><div class="plx-other abx-area">')
        + f'<span class="plx-other-n">{j:02d}</span><span class="min-w-0"><span class="plx-other-t">{_esc(a["title"])}</span>'
        + (f'<span class="plx-other-d">{_esc(a["text"])}</span>' if (a.get('text') or '').strip() else '') + '</span>'
        + ('<span class="plx-arr" aria-hidden="true">↗</span></a></li>' if a.get('pillar') in PILLAR_FILE else '</div></li>')
        for j, a in enumerate(areas, 1))
    acts = ''.join(f'<li class="plx-act"><span class="plx-act-ico">{j:02d}</span><span>{a}</span></li>' for j, a in enumerate(ACTIVITIES, 1))
    ap = c.get('approach') or {}
    steps = ''.join(f'<li class="plx-step"><span class="plx-step-n">{j:02d}</span><span class="plx-step-t">{_esc(s["title"])}</span><span class="plx-step-d">{_esc(s["text"])}</span></li>'
                    for j, s in enumerate(ap.get('steps') or [], 1))
    stats = abx_stats(c)
    st = c.get('statement') or {}
    st_paras = ''.join(f'<p>{_esc(p)}</p>' for p in st.get('paragraphs') or [] if p.strip())
    st_img = st.get('image')
    st_sig = (f'<div class="abx-sig">' + (f'<span class="abx-sig-img">{media_img(st_img, "h-full w-full", "64px")}</span>' if st_img else '')
              + f'<span><span class="abx-sig-n">{_esc(st.get("name") or "")}</span><span class="abx-sig-r">{_esc(st.get("role") or "")}</span></span></div>') if st.get('name') or st.get('role') else ''
    tabs = ([('statement', 'President’s statement')] if st_paras else []) + ([('journey', 'Journey')] if tl else []) + ([('different', 'What makes us different')] if pr else []) + ([('what-we-do', 'What we do')] if areas else []) \
        + ([('approach', 'Approach')] if steps or ap.get('title') else []) + [('impact', 'Impact')]
    body = page_header([ABOUT, ('Our Story', 'our-story.html')], 'About · Our Story', _title(c['hero']), _esc(c['hero'].get('lead') or '')) + f'''
<div class="plx abx"{_rev(c)}>
{abx_overview('our-story.html', '2007' if not c.get('foundedYear') else str(int(c['foundedYear'])), _esc(c.get('intro') or ''), facts,
              [('Our journey <span aria-hidden="true">↓</span>', '#journey' if tl else '#impact'), ('Our impact <span aria-hidden="true">↓</span>', '#impact')], side, 'Our Story')}
{abx_tabs(tabs)}
{f"""
<section id="statement" class="plx-sec py-14 lg:py-20">
  <div class="wrap">
    <div class="plx-pv">
      <div>
        <div class="sh-top"><span class="sh-num">{next(n):02d}</span><span class="sh-label">President’s Statement</span></div>
        {f'<p class="plx-k mt-8">{_esc(st["kicker"])}</p>' if st.get('kicker') else ''}
        <h2 class="plx-pv-title abx-st-title">{_esc(st.get('title') or '')}</h2>
      </div>
      <figure class="abx-st"><blockquote class="plx-pv-quote abx-st-q">{st_paras}</blockquote>{f'<figcaption>{st_sig}</figcaption>' if st_sig else ''}</figure>
    </div>
  </div>
</section>""" if st_paras else ''}
{f"""
<section id="journey" class="plx-sec py-14 lg:py-20">
  <div class="wrap">{sec_head(f'{next(n):02d} / Our Journey', 'From Ait Ourir <span class="sh-soft">to across Morocco.</span>', 'Since ' + str(c.get('foundedYear') or 2007), desc='How a local volunteer initiative became a national nonprofit.')}
    <ol class="abx-tl mt-8 lg:mt-12">{tl}</ol>
  </div>
</section>""" if tl else ''}
{f"""
<section id="different" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / What Makes Us Different', 'How we work, <span class="sh-soft">and why it lasts.</span>', f'{len(pr)} principles')}
    <div class="mt-8 lg:mt-10">{abx_rows(pr, 'abx-rows abx-2col')}</div>
  </div>
</section>""" if pr else ''}
{f"""
<section id="what-we-do" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / What We Do', f'{len(areas)} areas, <span class="sh-soft">one approach.</span>', ('Our pillars', 'pillars.html'), desc='Programmes combine non-formal education, practical training, mentoring and community action.')}
    <ul class="plx-others mt-8 lg:mt-10">{area_rows}</ul>
    <p class="plx-k mt-12">Core activities</p>
    <ul class="plx-acts abx-acts mt-4">{acts}</ul>
  </div>
</section>""" if areas else ''}
{f"""
<section id="approach" class="plx-sec py-10 lg:py-14">
  <div class="wrap">
    <div class="plx-pv">
      <div>
        <div class="sh-top"><span class="sh-num">{next(n):02d}</span><span class="sh-label">Our Approach</span></div>
        <h2 class="plx-pv-title">{_esc(ap.get('title') or '')}{f' <span class="text-ink-mid">{_esc(ap["soft"])}</span>' if ap.get('soft') else ''}</h2>
      </div>
      <ol class="plx-steps abx-steps">{steps}</ol>
    </div>
  </div>
</section>""" if steps or ap.get('title') else ''}

<section id="impact" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / Our Impact', 'A story <span class="sh-soft">of people.</span>', 'Since ' + str(c.get('foundedYear') or 2007), desc='The measure of this work is the people who carry it on.')}
    <div class="mt-8 lg:mt-10">{stats}</div>
  </div>
</section>
</div>
''' + abx_cta(c) + about_more('our-story.html')
    page('our-story.html', 'Our Story · AFCD Foundation',
         'How young volunteers founded AFCD Foundation in Ait Ourir in 2007, and how we work with communities.', 'about', body, parent=ABOUT)

    # ---------------------------------------------------------------- Mission & Vision: one path, from today to tomorrow
    c = about_content('mission-vision')
    vals = c.get('values') or []
    roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
    vrows = ''.join(f'<li class="abx-val"><span class="abx-val-n">{roman[j] if j < len(roman) else j + 1}</span><span class="min-w-0"><span class="abx-val-t">{_esc(v["title"])}</span><span class="abx-val-d">{_esc(v.get("text") or "")}</span></span></li>' for j, v in enumerate(vals))
    stages = [
        ('mission', 'Today', 'Our Mission', 'What we do, every day.', f'<p class="abx-path-q">{_esc(c.get("mission") or "")}</p>'),
        ('values', 'Every step', 'Our Values', f'{len(vals)} values shape how we work.', f'<ol class="abx-vals">{vrows}</ol>'),
        ('vision', 'Tomorrow', 'Our Vision', 'The society we work toward.', f'<p class="abx-path-q">{_esc(c.get("vision") or "")}</p>'),
        ('next', 'The way there', 'Our Strategy', f'{len(OBJECTIVES)} strategic objectives turn this vision into programmes.',
         f'<a href="strategy.html" class="plx-other abx-next"><span class="plx-other-n">SO</span><span class="min-w-0"><span class="plx-other-t">Strategy &amp; Objectives</span><span class="plx-other-d">{len(OBJECTIVES)} objectives, the people we serve and where we work.</span></span><span class="plx-arr" aria-hidden="true">↗</span></a>'),
    ]
    path = ''.join(f'''
      <li id="{sid}" class="abx-path-i plx-sec">
        <div class="abx-path-h"><span class="abx-path-n">{j:02d}</span><span class="abx-path-k">{k}</span></div>
        <div class="abx-path-b"><h2 class="abx-path-t">{t}</h2><p class="abx-path-s">{s}</p><div class="abx-path-c">{body_}</div></div>
      </li>''' for j, (sid, k, t, s, body_) in enumerate(stages, 1))
    body = page_header([ABOUT, ('Mission &amp; Vision', 'mission-vision.html')], 'About · Mission &amp; Vision', _title(c['hero']), _esc(c['hero'].get('lead') or '')) + f'''
<div class="plx abx"{_rev(c)}>
{abx_overview('mission-vision.html', 'M·V', _esc(c.get('mission') or ''), [('Mission', '01'), ('Values', f'{len(vals):02d}'), ('Objectives', f'{len(OBJECTIVES):02d}')],
              [('Read the path <span aria-hidden="true">↓</span>', '#mission'), ('Our strategy <span aria-hidden="true">↗</span>', 'strategy.html')], '', 'Mission &amp; Vision')}
{abx_tabs([('mission', 'Mission'), ('values', 'Values'), ('vision', 'Vision'), ('next', 'Strategy')])}
<section class="py-14 lg:py-20">
  <div class="wrap">{sec_head('01 / From Purpose to Future', 'From what we do today <span class="sh-soft">to the society we work toward.</span>', 'Mission · Values · Vision')}
    <ol class="abx-path mt-8 lg:mt-12">{path}
    </ol>
  </div>
</section>
</div>
''' + abx_cta(c) + about_more('mission-vision.html')
    page('mission-vision.html', 'Mission, Vision &amp; Values · AFCD Foundation',
         'AFCD Foundation’s mission, vision and values: ' + ', '.join(_esc(v['title']).lower() for v in vals[:-1]) + (' and ' if len(vals) > 1 else '') + (_esc(vals[-1]['title']).lower() if vals else '') + '.',
         'about', body, parent=ABOUT)

    # ---------------------------------------------------------------- Strategy
    c = about_content('strategy')
    n = num()
    def obj_links(links):
        if not links:
            return '<span class="abx-chip is-soft">Cross-cutting, all pillars</span>'
        return ''.join(f'<a class="abx-chip" href="pillars.html#{slug}">{name}</a>' for name, slug in links)
    objs = ''.join(f'''<li id="{ref.lower()}" class="abx-so"><span class="abx-so-ref">{ref}</span><span class="min-w-0"><span class="abx-so-t">{text}</span>{f'<span class="abx-so-d">{desc}</span>' if desc else ''}</span><span class="abx-so-p">{obj_links(links)}</span></li>'''
                   for ref, text, desc, links in OBJECTIVES)
    groups = ''.join(f'<li>{b}</li>' for b in BENEFICIARIES)
    summary = ''.join(f'<p>{_esc(p)}</p>' for p in c.get('summary') or [])
    regions = c.get('regions') or []
    reg = ''.join(f'<li class="abx-reg"><span class="abx-reg-n">{j:02d}</span><span class="abx-reg-t">{_esc(r["name"])}</span><span class="abx-reg-d">{_esc(r.get("places") or "")}</span></li>' for j, r in enumerate(regions, 1))
    body = page_header([ABOUT, ('Strategy &amp; Objectives', 'strategy.html')], 'About · Strategy', _title(c['hero']), _esc(c['hero'].get('lead') or '')) + f'''
<div class="plx abx"{_rev(c)}>
{abx_overview('strategy.html', f'{len(OBJECTIVES):02d}', _esc(c.get('objectivesIntro') or ''), [('Objectives', f'{len(OBJECTIVES):02d}'), ('Pillars', f'{PILLAR_COUNT:02d}'), ('Regions', f'{len(regions):02d}')],
              [('See the objectives <span aria-hidden="true">↓</span>', '#objectives'), ('Who we serve <span aria-hidden="true">↓</span>', '#who-we-serve')], '', 'Strategy &amp; Objectives')}
{abx_tabs([('objectives', 'Objectives'), ('who-we-serve', 'Who we serve'), ('where-we-work', 'Where we work')])}
<section id="objectives" class="plx-sec py-14 lg:py-20">
  <span id="strategy" class="pl-anchor" aria-hidden="true"></span>
  <div class="wrap">{sec_head(f'{next(n):02d} / Strategic Objectives', 'What AFCD <span class="sh-soft">works toward.</span>', f'SO-01 to SO-{len(OBJECTIVES):02d}', desc='Each objective links to the pillars that carry it.')}
    <ol class="abx-sos mt-8 lg:mt-10">{objs}</ol>
  </div>
</section>

<section id="who-we-serve" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / Who We Serve', 'People <span class="sh-soft">we work with.</span>', f'{len(BENEFICIARIES)} groups', desc=_esc(c.get('whoIntro') or ''))}
    <div class="plx-work mt-8 lg:mt-10">
      <div><p class="plx-k">Primary groups</p><ul class="plx-who mt-4">{groups}</ul></div>
      <div><p class="plx-k">In detail</p><div class="abx-paras abx-paras-lg mt-4">{summary}</div></div>
    </div>
  </div>
</section>

<section id="where-we-work" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / Where We Work', 'Places <span class="sh-soft">we serve.</span>', 'Across Morocco')}
    <ol class="abx-regs mt-8 lg:mt-10">{reg}</ol>
    {f'<div class="abx-note mt-8"><p class="plx-k">Coverage</p><p class="mt-3">{_esc(c["coverage"])}</p></div>' if c.get('coverage') else ''}
  </div>
</section>
</div>
''' + abx_cta(c) + about_more('strategy.html')
    page('strategy.html', 'Strategy &amp; Objectives · AFCD Foundation',
         f'AFCD Foundation’s {len(OBJECTIVES)} strategic objectives, linked to its {PILLARS_WORD} pillars, and who it works with across Morocco.', 'about', body, parent=ABOUT)

    # ---------------------------------------------------------------- Our Team
    c = about_content('team')
    n = num()
    people = c.get('people') or []
    by_group = [(g, label, [p for p in people if p.get('group') == g]) for g, label in TEAM_GROUPS]
    by_group = [x for x in by_group if x[2]]
    def person(p):
        img = p.get('image')
        vis = media_img(img, 'h-full w-full', '(min-width: 1024px) 22vw, 50vw') if img else f'<span class="abx-p-ini" aria-hidden="true">{_esc("".join(w[0] for w in (p.get("name") or "?").split()[:2]).upper())}</span>'
        bio = (p.get('bio') or '').strip()
        return (f'<li class="abx-p"><div class="abx-p-vis{" has-img" if img else ""}">{vis}</div><div class="abx-p-b"><span class="abx-p-n">{_esc(p["name"])}</span>'
                f'<span class="abx-p-r">{_esc(p.get("role") or "")}</span>' + (f'<span class="abx-p-d">{_esc(bio)}</span>' if bio else '') + '</div></li>')
    groups_html = ''.join(f'''
<section id="{g}" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / {label}', _esc(label) + '.', f'{len(ps)} ' + ('person' if len(ps) == 1 else 'people'))}
    <ul class="abx-ps mt-8 lg:mt-10">{''.join(person(p) for p in ps)}</ul>
  </div>
</section>''' for g, label, ps in by_group)
    if not by_group:
        groups_html = f'''
<section id="people" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(n):02d} / The Team', 'Meet <span class="sh-soft">the team.</span>', ('Join us', 'get-involved.html'))}
    <div class="plx-empty mt-8 lg:mt-10"><p class="plx-empty-t">Team profiles are not published yet.</p><p class="plx-empty-d">They appear here as soon as AFCD publishes them.</p><a href="get-involved.html" class="link-arrow mt-4">Get involved <span class="arr" aria-hidden="true">↗</span></a></div>
  </div>
</section>'''
    facts = [(label, f'{len(ps):02d}') for _g, label, ps in by_group][:4]
    body = page_header([ABOUT, ('Our Team', 'team.html')], 'About · Our Team', _title(c['hero']), _esc(c['hero'].get('lead') or '')) + f'''
<div class="plx abx"{_rev(c)}>
{abx_overview('team.html', f'{len(people):02d}' if people else 'AFCD', _esc(c.get('intro') or ''), facts,
              [('Meet the team <span aria-hidden="true">↓</span>', f'#{by_group[0][0]}' if by_group else '#people'), ('Join us <span aria-hidden="true">↗</span>', 'get-involved.html')], '', 'Our Team')}
{abx_tabs([(g, label) for g, label, _ps in by_group] or [('people', 'The team')])}
{groups_html}
</div>
''' + abx_cta(c) + about_more('team.html')
    page('team.html', 'Our Team · AFCD Foundation',
         'Meet the team behind AFCD Foundation’s programmes in Marrakech, Al Haouz and across Morocco.', 'about', body, parent=ABOUT)

    # ---------------------------------------------------------------- About hub: overview of the sub-pages, then impact
    story = about_content('our-story')
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

<section id="impact" class="border-t border-ink-light py-14 lg:py-16">
  <div class="wrap">{sec_head('02 / Our Impact', 'Our impact is <span class="sh-soft">a story of people.</span>', 'Since 2007', desc='The measure of this work is the people who carry it on.')}
    <div class="mt-8 lg:mt-10">{abx_stats(story)}</div>
  </div>
</section>
''' + abx_cta(story)
    page('about.html', 'About Us · AFCD Foundation',
         'About AFCD Foundation: a Moroccan nonprofit founded in 2007 in Ait Ourir. Our story, mission and vision, strategy and team.',
         'about', body)


ABOUT_PAGES = [
    ('our-story.html', 'Our Story', 'How young volunteers started AFCD in 2007, and how we work with communities.'),
    ('mission-vision.html', 'Mission &amp; Vision', 'What guides our work and the values we hold.'),
    ('strategy.html', 'Strategy &amp; Objectives', 'The objectives behind our programmes, and who we serve.'),
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
PILLAR_BRAND = {'green-thumbs': 'Green Thumbs'}
PILLAR_IMAGE = {}
for _p in STUDIO_PILLARS:   # Studio pillar content (see STUDIO_PILLARS above)
    _k = _p['key']
    PILLAR_INTRO[_k], PILLAR_SHORT[_k], PILLAR_ACTS[_k], PILLAR_GROUPS[_k] = _p['intro'], _p['short'], _p['activities'], _p['groups']
    PILLAR_APPROACH[_k] = dict(title=_p['approach']['title'], view=_p['approach']['view'], principles=_p['approach']['principles'],
                               steps=[tuple(x) for x in _p['approach']['steps']])
    PILLAR_BRAND[_k] = _p['brand']
    PILLAR_IMAGE[_k] = _p.get('image')


def pillars():
    # ---- one page per pillar
    # Monochrome by design: no pillar colours. Only real content: published projects, stories and events linked to the
    # pillar; sections without content (objectives, related) are left out instead of showing placeholders.
    ICO = lambda d_: f'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d_}</svg>'
    proj_by_name = {p_['name']: p_ for p_ in _PROJECT_DATA}
    stories_all = news_items()
    for i, (slug, n, t, d, rel) in enumerate(PILLARS):
        projs = [p for p in PROJECTS if slug in PROJECT_PILLARS.get(p[0], [p[1]])]
        pobj = [o for o in (STUDIO_PILLAR_BY_KEY.get(slug, {}).get('objectives') or []) if (o.get('title') or '').strip()]
        stories = [x for x in stories_all if slug in [q.get('key') for q in (x.get('pillars') or []) if isinstance(q, dict)] or x.get('pillar') == t][:3]
        evs = [e for e in EVENTS if not ev_sample(e) and (e.get('pillar') == slug or slug in (e.get('pillars') or []))]
        evs = sorted(evs, key=lambda e: (not e.get('upcoming'), e.get('iso') or ''))[:3]
        ap = PILLAR_APPROACH[slug]

        # -- overview: flagship programmes (the pillar's highlights) link to their project page when it exists
        def flag(name):
            pr = proj_by_name.get(name); href = pr.get('file') if pr and pr.get('detail') else None
            row = f'<span class="plx-flag-t">{_esc(name)}</span>' + (f'<span class="plx-flag-c">{_esc(pr["category"])}</span>' if pr and pr.get('category') else '')
            return f'<li><a href="{href}" class="plx-flag">{row}<span class="plx-arr" aria-hidden="true">↗</span></a></li>' if href else f'<li><span class="plx-flag">{row}</span></li>'
        flags = ''.join(flag(r) for r in rel)
        cover = PILLAR_IMAGE.get(slug)
        side = (f'<figure class="plx-photo">{media_img(cover, "h-full w-full", "(min-width: 1024px) 40vw, 100vw", eager=True)}</figure>' if cover else
                f'<div class="plx-side"><p class="plx-k">Flagship programmes</p><ul class="plx-flags">{flags}</ul></div>' if flags else '')
        facts = [('Projects', len(projs)), ('Activities', len(PILLAR_ACTS[slug]))] + ([('Objectives', len(pobj))] if pobj else []) + ([('Stories', len(stories))] if stories else [])
        facts_html = ''.join(f'<div class="plx-fact"><dt>{k}</dt><dd>{v:02d}</dd></div>' for k, v in facts)
        brand = f'<span class="plx-chip">Programme brand: {PILLAR_BRAND[slug]}</span>' if PILLAR_BRAND.get(slug) else ''
        steps_nav = ''.join(f'<a href="{PILLAR_FILE[s2]}" class="plx-pn{" is-on" if s2 == slug else ""}" title="{_esc(t2)}"{" aria-current=" + chr(34) + "page" + chr(34) if s2 == slug else ""}>{n2}</a>' for s2, n2, t2, _d2, _r2 in PILLARS)

        # -- perspective
        princ = ''.join(f'<li><span class="plx-pr-n">{j:02d}</span>{x}</li>' for j, x in enumerate(ap['principles'], 1))
        # -- objectives (only when published)
        pobj_html = ''.join(f'<li class="plx-obj"><span class="plx-obj-n">{j:02d}</span><span class="min-w-0"><span class="plx-obj-t">{_esc(o["title"])}</span>' + (f'<span class="plx-obj-d">{_esc(o.get("text") or "")}</span>' if (o.get('text') or '').strip() else '') + '</span></li>' for j, o in enumerate(pobj, 1))
        # -- how we work: steps, activities, people
        steps = ''.join(f'<li class="plx-step"><span class="plx-step-n">{j:02d}</span><span class="plx-step-t">{a}</span><span class="plx-step-d">{b}</span></li>' for j, (a, b) in enumerate(ap['steps'], 1))
        acts = ''.join(f'<li class="plx-act"><span class="plx-act-ico">{ICO(ACT_ICONS[a])}</span><span>{ACTIVITIES[a]}</span></li>' for a in PILLAR_ACTS[slug])
        groups = ''.join(f'<li>{_esc(BENEFICIARIES[g])}</li>' for g in PILLAR_GROUPS[slug])

        # -- projects: real ones only
        def pcard(pr, j):
            name, _sl, _pn, cat, href, summ = pr
            data = proj_by_name.get(name) or {}
            img = ((data.get('detail') or {}).get('cover') or [None])[0]
            st = project_status(name)
            visual = media_img(img, 'h-full w-full', '(min-width: 1024px) 30vw, 100vw') if img else f'<span class="plx-pj-mono" aria-hidden="true">{j:02d}</span>'
            meta = ''.join(x for x in [status_badge(st, 'is-sm') if st else '', f'<span class="plx-pj-cat">{cat}</span>' if cat else ''])
            inner = f'''<div class="plx-pj-vis{' has-img' if img else ''}">{visual}</div><div class="plx-pj-b"><div class="plx-pj-meta">{meta}</div><span class="plx-pj-t">{name}</span>{f'<span class="plx-pj-d">{summ}</span>' if summ else ''}<span class="plx-pj-go">{'Explore project' if href else 'Project page coming soon'}{' <span aria-hidden="true">↗</span>' if href else ''}</span></div>'''
            return f'<li><a href="{href}" class="plx-pj">{inner}</a></li>' if href else f'<li><div class="plx-pj is-static">{inner}</div></li>'
        proj_html = ''.join(pcard(p, j) for j, p in enumerate(projs, 1))
        proj_block = (f'<ul class="plx-pjs mt-8 lg:mt-10">{proj_html}</ul>' if projs else
                      f'<div class="plx-empty mt-8 lg:mt-10"><p class="plx-empty-t">No projects are published under this pillar yet.</p><p class="plx-empty-d">They appear here as soon as AFCD publishes them.</p><a href="projects.html" class="link-arrow mt-4">All projects <span class="arr" aria-hidden="true">↗</span></a></div>')

        # -- related: this pillar's stories and events
        def rel_row(href, kind, date, title_):
            return f'<li><a href="{href}" class="plx-rel"><span class="plx-rel-k">{kind}</span><span class="plx-rel-t">{title_}</span><span class="plx-rel-d">{date}</span><span class="plx-arr" aria-hidden="true">↗</span></a></li>'
        rel_rows = ''.join(rel_row(x.get('file') or f'news-{x["slug"]}.html', _esc(x.get('type') or 'Story'), _esc(x.get('dateLabel') or ''), _esc(x['title'])) for x in stories)
        rel_rows += ''.join(rel_row(event_file(e), 'Upcoming event' if e.get('upcoming') else 'Event', f'{e.get("day", "")} {e.get("mon", "")} {e.get("year", "")}'.strip(), e['title']) for e in evs)

        others = ''.join(f'''<li><a href="{PILLAR_FILE[s2]}" class="plx-other"><span class="plx-other-n">{n2}</span><span class="min-w-0"><span class="plx-other-t">{t2}</span><span class="plx-other-d">{PILLAR_INTRO.get(s2, d2)}</span></span><span class="plx-arr" aria-hidden="true">↗</span></a></li>'''
                         for s2, n2, t2, d2, _r2 in PILLARS if s2 != slug)

        tabs = [('overview', 'Overview'), ('perspective', 'Perspective')] + ([('objectives', 'Objectives')] if pobj else []) + [('how-we-work', 'How we work'), ('projects', 'Projects')] + ([('related', 'Related')] if rel_rows else []) + [('other-pillars', 'Other pillars')]
        num = iter(range(1, 20))
        body = page_header([('Our Pillars', 'pillars.html'), (t, PILLAR_FILE[slug])], f'Pillar {n} / {PILLARS_TOTAL}', t, PILLAR_INTRO[slug]) + f'''
<div class="plx">

<section id="overview" class="plx-sec pt-8 lg:pt-10">
  <div class="wrap">
    <div class="plx-hero{' has-side' if side else ''}">
      <div class="plx-hero-main">
        <div class="plx-hero-top">
          <span class="plx-big" aria-hidden="true">{n}</span>
          <div class="plx-hero-meta">{brand}<nav class="plx-pns" aria-label="All pillars">{steps_nav}</nav></div>
        </div>
        <p class="plx-lead">{d}</p>
        <dl class="plx-facts">{facts_html}</dl>
        <div class="plx-cta">
          <a href="#projects" class="plx-btn">See projects <span aria-hidden="true">↓</span></a>
          <a href="#how-we-work" class="plx-link">How we work <span aria-hidden="true">↓</span></a>
        </div>
        {share_bar(PILLAR_FILE[slug], t, 'Share this pillar', 'plx-share')}
      </div>
      {side}
    </div>
  </div>
</section>

<nav class="pl-tabs" aria-label="On this page" data-pl-tabs>
  <div class="wrap"><div class="pl-tabs-in">{''.join(f'<a href="#{a}" class="pl-tab">{b}</a>' for a, b in tabs)}</div></div>
</nav>

<section id="perspective" class="plx-sec py-14 lg:py-20">
  <div class="wrap">
    <div class="plx-pv">
      <div>
        <div class="sh-top"><span class="sh-num">{next(num):02d}</span><span class="sh-label">Our Perspective</span></div>
        <h2 class="plx-pv-title">{ap['title'].replace('text-white/45', 'text-ink-mid')}</h2>
      </div>
      <div>
        <blockquote class="plx-pv-quote">{ap['view']}</blockquote>
        <p class="plx-k mt-8">Guiding principles</p>
        <ol class="plx-prs">{princ}</ol>
      </div>
    </div>
  </div>
</section>
{f"""
<section id="objectives" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(num):02d} / Objectives', 'What this pillar <span class="sh-soft">aims to achieve.</span>', f'{len(pobj)} objective' + ('s' if len(pobj) != 1 else ''), desc='What AFCD works toward under this pillar.')}
    <ol class="plx-objs mt-8 lg:mt-10">{pobj_html}</ol>
  </div>
</section>""" if pobj else ''}

<section id="how-we-work" class="plx-sec py-10 lg:py-14">
  <span id="approach" class="pl-anchor" aria-hidden="true"></span><span id="what-we-do" class="pl-anchor" aria-hidden="true"></span>
  <div class="wrap">{sec_head(f'{next(num):02d} / How We Work', 'How this pillar <span class="sh-soft">comes to life.</span>', 'Approach · Activities', desc='The steps we follow and the activities we run under this pillar.')}
    <ol class="plx-steps mt-8 lg:mt-10">{steps}</ol>
    <div class="plx-work mt-10 lg:mt-14">
      <div><p class="plx-k">What it looks like</p><ul class="plx-acts mt-4">{acts}</ul></div>
      <div><p class="plx-k">Who we work with</p><ul class="plx-who mt-4">{groups}</ul></div>
    </div>
  </div>
</section>

<section id="projects" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(num):02d} / Projects', f'Projects in <span class="sh-soft">{PILLAR_SHORT[slug].lower()}.</span>', ('All projects', f'projects.html?pillar={slug}#by-pillar'), desc=f'Programmes AFCD runs under the {t} pillar.')}
    {proj_block}
  </div>
</section>
{f"""
<section id="related" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(num):02d} / Related', 'Stories and events <span class="sh-soft">from this pillar.</span>', ('All stories', 'news.html'))}
    <ul class="plx-rels mt-8 lg:mt-10">{rel_rows}</ul>
  </div>
</section>""" if rel_rows else ''}

<nav id="other-pillars" class="plx-sec border-t border-ink-light py-14 lg:py-16" aria-label="Other pillars">
  <div class="wrap">{sec_head(f'{next(num):02d} / Other Pillars', f'{PILLARS_WORD_CAP} pillars, <span class="sh-soft">one shared future.</span>', ('All pillars', 'pillars.html'))}
    <ul class="plx-others mt-8 lg:mt-10">{others}</ul>
  </div>
</nav>
</div>
''' + cta_band('Find your place in our work.', 'Volunteer, join a programme when calls open, or partner with us on this pillar.',
                  ('Get Involved', 'get-involved.html'), ('Partner with us', 'get-involved.html#partner'))
        page(PILLAR_FILE[slug], f'{t} · AFCD Foundation', f'{t}: {d}', 'pillars', body, parent=('Our Pillars', 'pillars.html'))

    # ---- hub
    cards = ''.join(f'''
      <li id="{slug}" class="scroll-mt-32"><a href="{PILLAR_FILE[slug]}" class="pl-card group" style="--c:#F4F4F3">
        <span class="flex items-start justify-between"><span class="pl-hero-n">{n}</span><span class="pj-nav-arr" style="position:static" aria-hidden="true">↗</span></span>
        <span class="mt-10 block text-[30px] font-semibold leading-[1.02] tracking-[-0.04em] md:text-[38px]">{t}</span>
        <span class="mt-4 block text-[15px] leading-relaxed text-black/70">{d}</span>
        <span class="mt-6 flex flex-wrap gap-2">{''.join(f'<span class="pg-tag">{r}</span>' for r in rel)}</span>
      </a></li>''' for slug, n, t, d, rel in PILLARS)
    body = page_header([('Our Pillars', 'pillars.html')], 'Our Pillars',
                       f'{PILLARS_WORD_CAP} pillars. <span class="text-ink-mid">One shared future.</span>',
                       f'{PILLARS_WORD_CAP} areas of action shape every AFCD programme, from leadership to the environment and digital inclusion.') + f'''

<section class="py-10 lg:py-14">
  <div class="wrap">
    <ul class="grid gap-3 md:grid-cols-2">{cards}
    </ul>
  </div>
</section>
''' + cta_band('Find your place in our work.', 'Volunteer, join a programme when calls open, or partner with us on a pillar.',
                  ('Get Involved', 'get-involved.html'), ('All projects', 'projects.html'))
    page('pillars.html', 'Our Pillars · AFCD Foundation',
         (', '.join(t for _s, _n, t, _d, _r in PILLARS[:-1]) + ' and ' if len(PILLARS) > 1 else '') + f'{PILLARS[-1][2]}: the {PILLARS_WORD} pillars of AFCD Foundation’s work.',
         'pillars', body)


# ---------------------------------------------------------------- Projects
def project_status(name):
    """Ongoing / Completed / Upcoming for a project, from the Duration (or Years) fact Studio exports; None without dates."""
    x = next((y for y in _PROJECT_DATA if y.get('name') == name), None)
    facts = dict(((x or {}).get('detail') or {}).get('facts') or [])
    return _status(facts.get('Duration') or facts.get('Years') or '')


def status_badge(st, cls=''):
    return f'<span class="pjg-badge is-{st.lower()} {cls}"><span class="pjg-pulse" aria-hidden="true"></span>{st}</span>' if st else ''


def project_card(p, featured=False):
    name, slug, pname, cat, href, summary = p
    inner = f'''
        {ph(name, 'aspect-[4/3] w-full', '#D4D4D4')}
        <div class="mt-5 flex flex-wrap items-center gap-2">{status_badge(project_status(name), 'is-sm')}{tag(pname)}<span class="label text-ink-mid">{cat}</span></div>
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
                       f'How shared ideas become community initiatives, across our {PILLARS_WORD} pillars.', points=('<b>10</b> Projects listed', '<b>3</b> Case studies')) + f'''

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
PILLAR_TONE.update({p['key']: p['colour'] for p in STUDIO_PILLARS})


def _read_more(v, limit=200):
    """Summary blocks stay short: plain text longer than ~200 characters folds after a sentence, with Read more."""
    if '<' in v or len(v) <= limit + 60:
        return f'<p>{v}</p>'
    cut = v.rfind('. ', 80, limit)
    cut = cut + 1 if cut > 0 else (v.rfind(' ', 0, limit) if v.rfind(' ', 0, limit) > 0 else limit)
    return f'<p>{v[:cut].rstrip()}</p><details class="pjs-more"><summary>Read more</summary><p>{v[cut:].strip()}</p></details>'


def _lightbox(imgs, title, cls, tile_cls, shown, sizes):
    """Photo tiles that open the full-screen viewer (assets/main.js [data-lb])."""
    full = lambda m: (m.get('srcset') or '').split(',')[-1].strip().split(' ')[0] or m['src']
    n = len(imgs)
    tiles = ''.join(
        f'<button type="button" class="{tile_cls}" data-lb-open="{i}" aria-label="Open photo {i + 1} of {n}">{media_img(m, "h-full w-full", sizes)}'
        + (f'<span class="pja-more">+{n - shown}</span>' if i == shown - 1 and n > shown else '') + '</button>' for i, m in enumerate(imgs[:shown]))
    items = ''.join(f'<li><img src="{full(m)}" alt="{_esc(m.get("alt") or "")}" width="{m.get("w", "")}" height="{m.get("h", "")}" loading="lazy" decoding="async"></li>' for m in imgs)
    return f'<div class="{cls}" data-lb data-lb-title="{_esc(title)}">{tiles}<ul hidden data-lb-items>{items}</ul></div>'


_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']


def _status(years, today=None):
    """Ongoing / Completed / Upcoming from the Duration text ("2025 – 2026", "April – November 2025", "March 2024 – present").
    None when there is no date to go by. Worked out each time the site is built (every publish)."""
    import datetime
    t = (years or '').strip().lower()
    if not t:
        return None
    today = today or datetime.date.today()
    if re.search(r'present|ongoing|today|now', t):
        return 'Ongoing'
    pts = [(int(y), (_MONTHS.index(m[:3]) + 1) if m else 0) for m, y in re.findall(r'(?:([a-z]{3,9})\.?\s+)?((?:19|20)\d{2})', t) if not m or m[:3] in _MONTHS]
    if not pts:
        return None
    first_month = next((_MONTHS.index(w[:3]) + 1 for w in re.findall(r'[a-z]{3,9}', t) if w[:3] in _MONTHS), 0)
    (sy, sm), (ey, em) = pts[0], pts[-1]
    start = (sy, first_month if (len(pts) == 1 and first_month) else (sm or 1))
    end = (ey, em or 12)
    now = (today.year, today.month)
    return 'Completed' if end < now else 'Upcoming' if start > now else 'Ongoing'


def project_details():
    files = list(DETAILS)
    for idx, (file, d) in enumerate(DETAILS.items()):
        pevents = [x for x in EVENTS if x.get('project') == file]
        tone = PILLAR_TONE[d['slug']]
        # cover: 3 to 5 photos (Studio "Cover photos") plus an optional 1:1 poster; empty places show a placeholder.
        photos = [m for m in (d.get('cover') or ([d['hero']] if d.get('hero') else [])) if m][:5]
        poster = d.get('poster') if (d.get('poster') or {}).get('src') else None
        # with a 1:1 poster: the poster first (left, shown whole), then four square photo tiles beside it
        n = 5 if poster else max(3, min(5, len(photos)))
        tiles = []   # (html, media or None, is_poster)
        order = ([('poster', None)] + [('photo', k) for k in range(0, 4)]) if poster else [('photo', k) for k in range(0, 5)]
        for kind, k in order:
            if len(tiles) == n:
                break
            if kind == 'poster':
                tiles.append((media_img(poster, 'h-full w-full', '(min-width:1024px) 45vw, 100vw', eager=True), poster, True))
            elif k < len(photos):
                big = k == 0 and not poster
                tiles.append((media_img(photos[k], 'h-full w-full', '(min-width:1024px) 60vw, 100vw' if big else '(min-width:1024px) 22vw, 50vw', eager=big), photos[k], False))
            else:
                tiles.append((ph(d['photo'] if (k == 0 and not poster) else f'{d["name"]} · photo {k + 1}', 'h-full w-full', '#D4D4D4' if (k == 0 and not poster) else '#E2E2E1'), None, False))
        real = [m for _h, m, _p in tiles if m]
        full = lambda m: (m.get('srcset') or '').split(',')[-1].strip().split(' ')[0] or m['src']
        cpos = {id(m): j for j, m in enumerate(real)}
        cells = ''.join(
            (f'<button type="button" class="pj-cover-i{" is-poster" if isp else ""}" data-lb-open="{cpos[id(m)]}" aria-label="{"Open the poster" if isp else f"Open photo {cpos[id(m)] + 1} of {len(real)}"}">{h}' + ('<span class="pj-cover-tag">Poster</span>' if isp else '') + '</button>')
            if m else f'<div class="pj-cover-i">{h}</div>' for h, m, isp in tiles)
        items = ''.join(f'<li><img src="{full(m)}" alt="{_esc(m.get("alt") or "")}" loading="lazy" decoding="async"></li>' for m in real)
        hero = (f'<div class="pj-cover {"is-poster-cover" if poster else f"n{n}"}"' + (f' data-lb data-lb-title="{_esc(d["name"])}"' if real else '') + f'>{cells}'
                + (f'<ul hidden data-lb-items>{items}</ul>' if real else '') + '</div>')
        gal = d.get('gallery') or []
        rev = d.get('revision') or ''
        # partner(s), duration and location appear once, in the "At a glance" panel (no facts bar on the cover).
        # Partners: the published partners linked in Studio's project editor; else a "Partner" extra fact; else the partners that list this project.
        fmap = {k: v for k, v in d['facts']}
        linked = [x.get('name') for x in (d.get('partners') or []) if x.get('name')]
        typed = next((v for k, v in d['facts'] if k in ('Partner', 'Partners')), '')
        pnames = linked or ([typed] if typed else [n for n, x in PARTNER_DETAILS.items() if any((pr or {}).get('file') == file for pr in (x.get('projects') or []))])
        years = fmap.get('Duration') or fmap.get('Years') or ''
        rowmap = {k: v for k, v in d['rows']}
        summ_rows = [(k, v) for k, v in d['rows'] if k not in ('Activities', 'Results') and v]
        pobj = [o for o in (d.get('programObjectives') or []) if (o.get('title') or '').strip()]
        outs = [o for o in (d.get('outcomes') or []) if (o.get('title') or o.get('text') or '').strip()]
        acts = [x for x in (d.get('activities') or []) if (x.get('title') or '').strip()]
        outputs = d.get('outputs') or []

        # impact strip under the cover: outcome figures first ("120" · "young people trained"), then the other extra facts
        extra = [(k, v) for k, v in d['facts'] if k not in ('Pillar', 'Category', 'Location', 'Years', 'Duration', 'Partner', 'Partners') and v]
        impact = [(_esc(o['figure']), _esc(o.get('title') or '')) for o in outs if (o.get('figure') or '').strip()] + [(v, k) for k, v in extra]
        impact = impact[:4]
        impact_html = ('<dl class="pj-stats" style="--n:' + str(len(impact)) + '">' + ''.join(f'<div class="pj-stat"><dd>{v}</dd><dt>{k}</dt></div>' for v, k in impact) + '</dl>') if impact else ''

        # project logo (Studio): its own shape or a frame (1:1, circle, 3:1, 2:1, 4:3, 16:9, 3:4, 1:3), whole or cropped, on a background
        lg = d.get('logo'); logo_html = ''
        if lg and lg.get('src'):
            shape = lg.get('shape') if lg.get('shape') in ('original', '1:1', 'circle', '3:1', '2:1', '4:3', '16:9', '3:4', '1:3') else 'original'
            ratio = f'{lg["w"]} / {lg["h"]}' if shape == 'original' else '1 / 1' if shape == 'circle' else shape.replace(':', ' / ')
            bg = lg.get('bg') if lg.get('bg') in ('none', 'white', 'light', 'dark', 'pillar') else 'white'
            size = lg.get('size') if lg.get('size') in ('s', 'm', 'l') else 'm'
            tall = shape in ('3:4', '1:3') or (shape == 'original' and lg['h'] > lg['w'])
            look = f'bg-{bg}' + (' round' if shape == 'circle' else '') + (' cover' if lg.get('fit') == 'cover' else '') + (' tall' if tall else '')
            logo_html = f'<span class="pj-logo s-{size} {look}" style="aspect-ratio:{ratio}">{media_img(lg, "pj-logo-img", "240px")}</span>'

        # sections that have content, numbered in order; empty ones are left out (and so are their tabs)
        secs = []
        sec = lambda key, label: secs.append((key, label)) or f'{len(secs):02d}'

        # 01 summary: the lede, short blocks with Read more, and the sticky "at a glance" panel
        blocks = ''.join(f'<div class="pjs-block"><h3 class="pjs-k">{k}</h3>{_read_more(v)}</div>' for k, v in summ_rows)
        # the panel: status (from the duration) and dates, then each fact with its icon, label above the value
        status = _status(years)
        GI = {'partner': '<path d="M5.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 15.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5M12 8.5a2.2 2.2 0 1 0 0-4.4M11.5 11c2 0 3.5 1.9 3.5 4.5"/>',
              'pin': '<path d="M8 14.5s4.5-4.2 4.5-8A4.5 4.5 0 0 0 3.5 6.5c0 3.8 4.5 8 4.5 8Z"/><circle cx="8" cy="6.5" r="1.6"/>',
              'pillar': '<path d="M1.5 14.5h13M3.5 12V7.5M6.5 12V7.5M9.5 12V7.5M12.5 12V7.5M8 1.5l6.5 4h-13z"/>',
              'tag': '<path d="M8.6 1.5H14.5v5.9l-7 7-5.9-5.9 7-7Z"/><circle cx="11.3" cy="4.7" r="1"/>'}
        gico = lambda k: f'<span class="pjg-ico" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">{GI[k]}</svg></span>'
        glance = [('partner', 'Partners' if len(pnames) > 1 else 'Partner', ', '.join(pnames)), ('pin', 'Location', fmap.get('Location', '')),
                  ('pillar', 'Pillar', f'<a href="{PILLAR_FILE.get(d["slug"], "pillars.html")}" class="pjg-link">{d["pillar"]}</a>'),
                  ('tag', 'Categories' if ',' in d['cat'] else 'Category', d['cat'])]
        plogos = [(n, partner_logo(n)) for n in pnames if partner_logo(n)]
        if plogos:   # the partners' own logos (Studio → Partners), shown with the names
            glance[0] = ('partner', glance[0][1], '<span class="pjg-plogos">' + ''.join(
                f'<span class="pjg-plogo {logo_shape(lg)}"><img src="{lg["src"]}" alt="{lg.get("alt") or n}" loading="lazy" decoding="async"></span>' for n, lg in plogos) + '</span>' + glance[0][2])
        glance_rows = ''.join(f'<div class="pjg-row">{gico(i)}<div class="min-w-0"><dt>{k}</dt><dd>{v}</dd></div></div>' for i, k, v in glance if v)
        status_html = ((f'<div class="pjg-status">' + (f'<span class="pjg-badge is-{status.lower()}"><span class="pjg-pulse" aria-hidden="true"></span>{status}</span>' if status else '')
                        + (f'<span class="pjg-dates"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5.5 1.5v3M10.5 1.5v3"/></svg>{years}</span>' if years else '') + '</div>')
                       if (status or years) else '')
        # the project's most relevant event: the next upcoming one, else the most recent past one
        nxt = sorted([e for e in pevents if e.get('upcoming')], key=lambda e: e.get('iso') or '')
        past = sorted([e for e in pevents if not e.get('upcoming')], key=lambda e: e.get('iso') or '', reverse=True)
        ev = (nxt or past or [None])[0]
        ev_html = (f'<a href="{event_file(ev)}" class="pjg-ev"><span class="pjg-ev-d"><b>{ev["day"]}</b>{ev["mon"]} {ev["year"]}</span>'
                   f'<span class="min-w-0 flex-1"><span class="pjg-k">{"Next event" if ev.get("upcoming") else "Latest event"}</span><span class="pjg-ev-t">{ev["title"]}</span></span>'
                   f'<span aria-hidden="true">↗</span></a>') if ev else ''
        dl_html = ''
        if outputs:
            dl_html = ('<div class="pjg-dl"><span class="pjg-k">Downloads</span><ul>' + ''.join(
                f'<li><a href="{o["file"]}"><span class="pjg-doc" aria-hidden="true"></span><span class="min-w-0 flex-1 truncate">{o["title"]}</span><span aria-hidden="true">↗</span></a></li>' for o in outputs[:3])
                + '</ul>' + (f'<a href="#publications" class="pjg-all">All {len(outputs)} publications</a>' if len(outputs) > 3 else '') + '</div>')
        n1 = sec('about', 'Summary')
        about = f"""
<section id="about" class="pl-sec py-8 lg:py-10">
  <div class="wrap">
    <div class="pjs2">
      <div class="pjs2-main">
        <div class="sh-top"><span class="sh-num">{n1}</span><span class="sh-label">Project Summary</span></div>
        <p class="pjs-lede">{d['lede']}</p>
        {f'<div class="pjs-blocks">{blocks}</div>' if blocks else ''}
      </div>
      <aside class="pjg" aria-label="At a glance">
        {f'<div class="pjg-logo">{logo_html}</div>' if logo_html else ''}
        {status_html}
        <dl class="pjg-list">{glance_rows}</dl>
        {ev_html}
        {dl_html}
        {share_bar(file, d['name'], 'Share', 'pjg-share')}
      </aside>
    </div>
  </div>
</section>"""

        # objectives: a numbered row
        obj_sec = ''
        if pobj:
            nn = sec('objectives', 'Objectives')
            row = ''.join(f'<li class="pjn-i"><span class="pjn-n">{j:02d}</span><span class="pjn-c"><span class="pjn-t">{_esc(o["title"])}</span>'
                          + (f'<span class="pjn-d">{_esc(o.get("text") or "")}</span>' if (o.get('text') or '').strip() else '') + '</span></li>' for j, o in enumerate(pobj, 1))
            obj_sec = f"""
<section id="objectives" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Program Objectives', 'What the programme <span class="sh-soft">sets out to do.</span>', f'{len(pobj)} objective' + ('s' if len(pobj) != 1 else ''), desc='The objectives this programme works towards.')}
    <ol class="pjn{' is-many' if len(pobj) > 4 else ''} mt-8 lg:mt-10">{row}</ol>
  </div>
</section>"""

        # outcomes
        out_sec = ''
        if outs or rowmap.get('Results'):
            nn = sec('outcomes', 'Outcomes')
            if outs:
                out_block = '<ul class="pjo-grid mt-8 lg:mt-10">' + ''.join(
                    f'<li class="pjo-card">' + (f'<span class="pjo-fig">{_esc(o.get("figure") or "")}</span>' if (o.get('figure') or '').strip() else f'<span class="pjo-n">{j:02d}</span>')
                    + (f'<span class="pjo-t">{_esc(o.get("title") or "")}</span>' if (o.get('title') or '').strip() else '')
                    + (f'<span class="pjo-d">{_esc(o.get("text") or "")}</span>' if (o.get('text') or '').strip() else '') + '</li>' for j, o in enumerate(outs, 1)) + '</ul>'
            else:
                out_block = f'<div class="pjo-result mt-8 lg:mt-10"><span class="pjo-n">01</span><p>{rowmap["Results"]}</p></div>'
            out_sec = f"""
<section id="outcomes" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Outcomes', 'What changed <span class="sh-soft">for people.</span>', f'{len(outs)} outcomes' if outs else 'Results', desc='Results and changes the programme has achieved so far.')}
    {out_block}
  </div>
</section>"""

        # activities: each has a title, a description and its pictures (left out when there are none)
        act_sec = ''
        if not acts and rowmap.get('Activities'):
            acts = [{'title': 'Programme activities', 'text': rowmap['Activities'], 'images': gal}]
        def act_photos(x, j):
            imgs = [m for m in (x.get('images') or ([x['image']] if x.get('image') else [])) if m]
            if not imgs:
                return '<div class="pja-ph n1">' + ph(_esc(x['title']) + ' · photo', 'h-full w-full rounded-[14px]', '#E6E6E5') + '</div>'
            k = min(len(imgs), 3)
            full = lambda m: (m.get('srcset') or '').split(',')[-1].strip().split(' ')[0] or m['src']
            n = len(imgs)
            tiles = ''.join(
                f'<button type="button" class="pja-pi" data-lb-open="{i}" aria-label="Open photo {i + 1} of {n}">{media_img(m, "h-full w-full rounded-[14px]", "(min-width:1024px) 40vw, 100vw")}'
                + (f'<span class="pja-more">+{n - 3}</span>' if i == 2 and n > 3 else '') + '</button>' for i, m in enumerate(imgs[:3]))
            items = ''.join(f'<li><img src="{full(m)}" alt="{_esc(m.get("alt") or "")}" width="{m.get("w", "")}" height="{m.get("h", "")}" loading="lazy" decoding="async"></li>' for m in imgs)
            return (f'<div class="pja-ph n{k}" data-lb data-lb-title="{_esc(x["title"])}">{tiles}'
                    f'<ul hidden data-lb-items>{items}</ul>'
                    f'<span class="pja-count" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="7" r="1.2"/><path d="m3 12 3.5-3 2.5 2 2-1.5 2 1.5"/></svg>{n}</span></div>')
        # publications linked to the activity in Studio (published ones only; values arrive HTML-escaped)
        def act_pubs(x):
            pubs = [p for p in (x.get('publications') or []) if isinstance(p, dict) and p.get('file')]
            if not pubs:
                return ''
            # the publication card opens its page; "Download PDF" gets the file straight away (when it has one)
            dl = lambda p: (f'<a href="{p["pdf"]}" download="{p.get("slug") or "publication"}.pdf" type="application/pdf" class="pja-dl"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/></svg>Download PDF</a>'
                            if str(p.get('pdf') or '').startswith('assets/documents/') else '')
            return '<ul class="pja-pubs">' + ''.join(
                f'<li class="pja-pub-li"><a href="{p["file"]}" class="pja-pub"><span class="pjd-ico" aria-hidden="true"></span><span class="min-w-0 flex-1"><span class="pja-pub-k">{p.get("type") or "Publication"}{(" · " + p["year"]) if p.get("year") else ""}</span>'
                f'<span class="pja-pub-t">{p["title"]}</span></span><span aria-hidden="true">↗</span></a>{dl(p)}</li>' for p in pubs) + '</ul>'
        if acts:
            nn = sec('activities', 'Activities')
            act_block = '<ol class="pja-list mt-8 lg:mt-10">' + ''.join(
                f'<li class="pja-row"><div class="pja-text"><span class="pjo-n">{j:02d}</span><span class="pja-t">{_esc(x["title"])}</span>'
                + (f'<p class="pja-d">{x["text"] if x.get("title") == "Programme activities" and not d.get("activities") else _esc(x.get("text") or "")}</p>' if (x.get('text') or '').strip() else '')
                + act_pubs(x) + f'</div>{act_photos(x, j)}</li>' for j, x in enumerate(acts, 1)) + '</ol>'
            act_sec = f"""
<section id="activities" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Program Activities', 'The programme <span class="sh-soft">in action.</span>', (f'{len(acts)} activit' + ('ies' if len(acts) != 1 else 'y')) if d.get('activities') else 'Photos to come', desc='What participants do, each activity with its own photos.')}
    {act_block}
  </div>
</section>"""

        # publications: published publications (Studio: Publications → Projects) that come from this project
        outp_sec = ''
        if outputs:
            nn = sec('publications', 'Publications')
            rows = ''.join(f'<li class="pjd-li"><a href="{o["file"]}" class="pjd"><span class="pjd-ico" aria-hidden="true"></span><span class="min-w-0 flex-1"><span class="pjd-type">{o["type"]}{(" · " + o["year"]) if o.get("year") else ""}</span>'
                           f'<span class="pjd-t">{o["title"]}</span></span><span class="pjd-go">Read <span aria-hidden="true">↗</span></span></a>'
                           + (f'<a href="{o["pdf"]}" download="{o.get("slug") or "publication"}.pdf" type="application/pdf" class="pja-dl pjd-dl"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10"/></svg>Download PDF</a>' if str(o.get('pdf') or '').startswith('assets/documents/') else '')
                           + '</li>' for o in outputs)
            outp_sec = f"""
<section id="publications" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Publications', 'Papers and reports <span class="sh-soft">from the programme.</span>', f'{len(outputs)} publication' + ('s' if len(outputs) != 1 else ''), ('All publications', 'publications.html'))}
    <ul class="pjd-list mt-8 lg:mt-10">{rows}</ul>
  </div>
</section>"""

        # photo wall: gallery photos not already on the cover
        on_cover = {m.get('id') or m.get('src') for m in real}
        wall = [m for m in gal if m and (m.get('id') or m.get('src')) not in on_cover]
        wall_sec = ''
        if wall:
            nn = sec('photos', 'Photos')
            wall_sec = f"""
<section id="photos" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Photos', 'Moments <span class="sh-soft">from the programme.</span>', f'{len(wall)} photo' + ('s' if len(wall) != 1 else ''))}
    {_lightbox(wall, d['name'], 'pjw mt-8 lg:mt-10', 'pjw-i', len(wall), '(min-width:1024px) 30vw, 50vw')}
  </div>
</section>"""

        ev_sec = ''
        if pevents:
            nn = sec('events', 'Events')
            ev_sec = f"""
<section id="events" class="pl-sec py-8 lg:py-10">
  <div class="wrap">{sec_head(f'{nn} / Events', 'Related <span class="sh-soft">events.</span>', f'{len(pevents)} linked', ('All events', 'events.html'))}
    <ul class="ev-list mt-8 lg:mt-10">{"".join(event_row(x, compact=True) for x in pevents)}</ul>
  </div>
</section>"""

        tabs = ''.join(f'<a href="#{k}" class="pl-tab">{l}</a>' for k, l in secs)

        # more projects: never this page; one link when there is only one other project, none when this is the only one
        others = [f for f in files[idx + 1:] + files[:idx] if f != file]
        def nav(f, label):
            o = DETAILS[f]
            return f'''<a href="{f}" class="pj-nav group"><span class="label text-ink-mid">{label}</span><span class="mt-3 flex items-center gap-3"><span class="pj-dot" style="--c:{PILLAR_TONE[o['slug']]}"></span><span class="text-[24px] font-semibold tracking-[-0.03em] md:text-[30px]">{o['name']}</span></span><span class="mt-1 block text-[14px] text-ink-mid">{o['pillar']} · {o['cat']}</span><span class="pj-nav-arr" aria-hidden="true">↗</span></a>'''
        if len(others) >= 2:
            more = nav(others[-1], 'Previous project') + nav(others[0], 'Next project')
        elif others:
            more = nav(others[0], 'Next project')
        else:
            more = ''
        more_html = f'''
<nav class="py-10 lg:py-12" aria-label="More projects">
  <div class="wrap grid gap-3 md:grid-cols-2">{more}</div>
</nav>''' if more else ''

        body = page_header([('Projects', 'projects.html'), (d['name'], file)], f'{d["pillar"]} · {d["cat"]}', d['name'], d['lede']) + f"""
<div class="pl-page" style="--pc:{tone}">
<section id="summary" class="pl-sec pt-8 lg:pt-10" data-studio-rev="{rev}">
  <div class="wrap">
    <div class="pj-hero">
      {hero}
    </div>
    {impact_html}
  </div>
</section>

<nav class="pl-tabs" aria-label="On this page" data-pl-tabs>
  <div class="wrap"><div class="pl-tabs-in">{tabs}</div></div>
</nav>
{about}{obj_sec}{out_sec}{act_sec}{outp_sec}{wall_sec}{ev_sec}
</div>
{more_html}""" + cta_band('Be part of the next edition.', 'Calls for applications, volunteering and partnerships open throughout the year.',
               ('Get Involved', 'get-involved.html'), ('All projects', 'projects.html'))
        page(file, f'{d["name"]} · AFCD Foundation', f'{d["name"]}: {d["lede"]}', 'projects', body)


# ---------------------------------------------------------------- Homepage events list (from EVENTS)
def home_events():
    """Writes the homepage's upcoming-events list (up to 3, real events only) between the home-events markers."""
    idx = Path(__file__).parent / 'pages' / 'index.html'
    if not idx.exists():
        return
    html = idx.read_text(encoding='utf-8')
    a, b = '<!-- home-events:start -->', '<!-- home-events:end -->'
    if a not in html or b not in html:
        return
    up = [e for e in EVENTS if e.get('upcoming') and not ev_sample(e)][:3]
    inner = (f'<ul class="ev-list mt-8 lg:mt-10">{"".join(event_row(e) for e in up)}\n    </ul>' if up else
             '<div class="po-empty mt-8 lg:mt-10"><span class="po-empty-ico" aria-hidden="true"></span><span><span class="block text-[17px] font-semibold tracking-[-0.015em]">New events will be announced here.</span><span class="mt-1 block text-[14.5px] text-ink-dark"><a class="link-arrow" href="events.html">See all events <span class="arr" aria-hidden="true">↗</span></a></span></span></div>')
    new = html[:html.index(a)] + f'{a}\n    {inner}\n    {b}' + html[html.index(b) + len(b):]
    if new != html:
        idx.write_text(new, encoding='utf-8')



def logo_shape(lg):
    """Partner logos are sized by shape so they look equally weighted: square ones tallest, wide ones shortest."""
    w, h = (lg or {}).get('w') or 0, (lg or {}).get('h') or 0
    r = (w / h) if w and h else 2
    return 'is-square' if r < 1.35 else 'is-mid' if r < 2.6 else 'is-wide'


def partner_logo(name):
    lg = (PARTNER_DETAILS.get(name) or {}).get('logo') or {}
    return lg if lg.get('src') else None

# ---------------------------------------------------------------- Homepage partner strip (from the Partners module)
def home_partners():
    """Writes the homepage partner strip's names, logos and counts into src/pages/index.html (assets/main.js draws the strip)."""
    idx = Path(__file__).parent / 'pages' / 'index.html'
    if not idx.exists():
        return
    html = idx.read_text(encoding='utf-8')
    if '<template id="partner-data">' not in html:
        return
    def li(n):
        lg = (PARTNER_DETAILS.get(n) or {}).get('logo') or {}
        # names, alt text and paths arrive HTML-escaped from Studio
        return f'<li data-logo="{lg["src"]}" data-alt="{lg.get("alt") or ""}" data-shape="{logo_shape(lg)}">{n}</li>' if lg.get('src') else f'<li>{n}</li>'
    data = ''.join(f'<ul data-g="{g}">' + ''.join(li(n) for n in names) + '</ul>' for g, names in PARTNERS)
    new = re.sub(r'<template id="partner-data">.*?</template>', lambda m: f'<template id="partner-data">{data}</template>', html, count=1, flags=re.S)
    counts = {g: len(n) for g, n in PARTNERS}
    new = re.sub(r'(tabular-nums">)\d+(</span><span class="text-sm text-ink-dark">partners since)', lambda m: f'{m.group(1)}{sum(counts.values())}{m.group(2)}', new, count=1)
    for g in ('International', 'National', 'Local'):
        new = re.sub(rf'(data-g="{g}" aria-pressed="false">{g} <span>)\d+(</span>)', lambda m: f'{m.group(1)}{counts.get(g, 0)}{m.group(2)}', new, count=1)
    if new != html:
        idx.write_text(new, encoding='utf-8')

# ---------------------------------------------------------------- Homepage project cards (from the project module)
def home_projects():
    """Writes the featured project cards' data into src/pages/index.html (between the home-projects markers)."""
    idx = Path(__file__).parent / 'pages' / 'index.html'
    if not idx.exists():
        return
    html = idx.read_text(encoding='utf-8')
    a, b = '<!-- home-projects:start -->', '<!-- home-projects:end -->'
    if a not in html or b not in html:
        return
    items = [x for x in _PROJECT_DATA if x.get('file') and x.get('detail')][:3]   # the first three by Studio order
    cards = []
    for i, x in enumerate(items):
        d = x['detail']
        rows = {k: v for k, v in (d.get('rows') or [])}
        acts = [y for y in (d.get('activities') or []) if (y.get('title') or '').strip()]
        outs = [y for y in (d.get('outcomes') or []) if (y.get('title') or y.get('text') or '').strip()]

        def lead(text):   # the card keeps it short: the first sentence; the full text is on the project page
            first = next((' '.join(p.split()) for p in re.split(r'\n\s*\n', text or '') if p.strip()), '')
            m = re.match(r'(.{40,}?[.!?])\s', first)
            return (m.group(1) if m else first), bool(m) or len(first) < len(' '.join((text or '').split()))

        tiles = [(k,) + lead(rows[k]) for k in ('Context', 'Approach') if rows.get(k)]
        # key facts, only those Studio has (rows, facts and partner names arrive HTML-escaped from Studio's publish): published partners, then the project's own facts (duration, location, ...)
        facts = []
        partners = [p['name'] for p in (d.get('partners') or []) if p.get('name')]
        if partners:
            facts.append(('Partner' if len(partners) == 1 else 'Partners', ', '.join(partners)))
        facts += [(k, v) for k, v in (d.get('facts') or []) if v and k not in ('Pillar', 'Category')]
        # outcomes with a figure ("2 workshops") make the impact strip; the title says what it was
        figs = [y for y in outs if (y.get('figure') or '').strip()][:4]
        # 1:1 image: the poster when Studio has one (shown whole), else the main photo
        # (cropped to the square at its focal point, unless it is a tall document-like image, which is shown whole)
        pic = d.get('poster') or d.get('hero')
        fit = 'contain' if d.get('poster') or (pic and pic.get('h', 0) > 1.1 * pic.get('w', 1)) else 'cover'
        img = media_img(pic, 'pc-img', '(min-width:1024px) 30vw, 100vw') if pic else ''
        cards.append(
            f'<article data-n="{i + 1:02d}" data-status="{project_status(x["name"]) or ""}" data-href="{x["file"]}" data-dot="{PILLAR_TONE.get(x.get("pillar"), "#111")}" data-surface="pc-{i % 3 + 1}" data-ph="{["#E2E2E2", "#E6E6E6", "#DADADA"][i % 3]}" data-fit="{fit}">'
            f'<h3>{_esc(x["name"])}</h3><span class="pp">{_PILLAR_NAMES.get(x.get("pillar"), "")}</span><span class="pk">Case study</span><span class="pc">{_esc(x.get("category") or "")}</span>'
            f'<p class="ph">{_esc(d.get("photo") or (x["name"] + " · project photo"))}</p>{img}'
            + ('<ul class="pf">' + ''.join(f'<li><b>{k}</b><span>{v}</span></li>' for k, v in facts[:3]) + '</ul>' if facts else '')
            + ('<ul class="po">' + ''.join(f'<li><b>{_esc(y["figure"])}</b><span>{_esc(y.get("title") or y.get("text") or "")}</span></li>' for y in figs) + '</ul>' if figs else '')
            + '<dl>' + ''.join(f'<div{" data-more" if more else ""}><dt>{k}</dt><dd>{v}</dd></div>' for k, v, more in tiles) + '</dl></article>')
    block = f'{a}\n    <template id="home-projects-data">{"".join(cards)}</template>\n    {b}'
    new = html[:html.index(a)] + block + html[html.index(b) + len(b):]
    if new != html:
        idx.write_text(new, encoding='utf-8')

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
NEWS_PILLAR.update({p['name']: p['colour'] for p in STUDIO_PILLARS})
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
        {share_bar(it['file'], it['title'], 'Share this story')}
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
# Built-in events: none. Every event comes from AFCD Studio (src/data/events.json, loaded below).
EVENTS = []
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
        # a real event lists only other real events, never the lorem-ipsum samples
        others = [x for x in EVENTS if x is not e and x['upcoming'] and (ev_sample(e) or not ev_sample(x))][:3]
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
        count = '<span class="evd-count">Date to be announced</span>' if e.get('tba') else f'<span class="evd-count" data-countdown="{e["iso"]}" hidden></span>' if e['upcoming'] else '<span class="evd-count is-past">Past event</span>'
        cal = (f'<button type="button" class="evd-tool" data-ics data-uid="afcd-{e["slug"]}" data-start="{e["iso"]}" data-time="{e["time"]}" '
               f'data-title="{e["title"]}" data-where="{e["where"]}">{evd_ico("cal")}Add to calendar</button>') if e['upcoming'] and not e.get('tba') else ''
        tools = f'<div class="evd-tools{" is-one" if not cal else ""}">{cal}<button type="button" class="evd-tool" data-share>{evd_ico("share")}Share</button></div>' + share_bar(event_file(e), e['title'], 'Share this event', 'is-card')
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
        if e.get('tba') and not online:
            loc = f'''<div class="evd-loc mt-8"><span class="evd-loc-ico">{ev_ico('pin')}</span><span class="min-w-0"><span class="block text-[18px] font-semibold tracking-[-0.02em]">Venue to be announced</span><span class="mt-1 block text-[14px] leading-relaxed text-ink-dark">The city and venue will be published here. Register your interest to be told first.</span></span></div>'''
        elif online:
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
    # the logo uploaded in Studio (Partners → Logo); initials until there is one
    def logo(n):
        lg = (PARTNER_DETAILS.get(n) or {}).get('logo')
        if lg and lg.get('src'):
            return f'<span class="pr-logo has-img {logo_shape(lg)}">{media_img(lg, "pr-logo-img", "220px")}</span>'
        return f'<span class="pr-logo" aria-hidden="true"><span>{initials(n)}</span></span>'
    with_logo = sum(1 for _g, names in PARTNERS for n in names if ((PARTNER_DETAILS.get(n) or {}).get('logo') or {}).get('src'))
    # a card per partner: the logo on a calm stage (sized by its shape), then what Studio knows about the partnership
    def card(g, n):
        x = PARTNER_DETAILS.get(n) or {}
        status = ('Current partner' if x.get('current') else 'Past partner') if 'current' in x else ''
        since = f'since {x["since"]}' if x.get('since') else ''
        meta = ''.join(f'<span class="pr-meta-i">{v}</span>' for v in (status, since) if v)
        projs = [(pr.get('file'), pr.get('name') or (DETAILS.get(pr.get('file')) or {}).get('name')) for pr in (x.get('projects') or []) if isinstance(pr, dict) and pr.get('file')]
        projs = [(f, nm) for f, nm in projs if nm]
        url = x.get('url') or ''
        return (f'<li class="pr-card" data-group="{g}" data-name="{n.lower()}">'
                f'<div class="pr-stage">{logo(n)}</div>'
                f'<div class="pr-body"><span class="pr-scope">{ico(g)}{g}</span>'
                f'<span class="pr-name">{n}</span>'
                + (f'<span class="pr-meta">{meta}</span>' if meta else '')
                + (f'<span class="pr-desc">{x["description"]}</span>' if (x.get('description') or '').strip() else '')
                + (f'<span class="pr-projs"><span class="pr-projs-k">Projects</span>' + ''.join(f'<a href="{f}" class="pr-proj">{nm}</a>' for f, nm in projs) + '</span>' if projs else '')
                + (f'<a href="{url}" class="pr-web" target="_blank" rel="noopener noreferrer">Website <span aria-hidden="true">↗</span></a>' if url.startswith('https://') else '')
                + '</div></li>')
    cards = ''.join(card(g, n) for g, names in PARTNERS for n in names)
    pc = about_content('partners')
    models = pc.get('models') or []
    mk = ['fund', 'design', 'share']
    mhtml = ''.join(f'<li class="plx-act abx-model"><span class="plx-act-ico">{ico(mk[i] if i < len(mk) else "share")}</span><span class="min-w-0"><span class="abx-model-t">{_esc(m["title"])}</span><span class="abx-model-d">{_esc(m.get("text") or "")}</span></span></li>' for i, m in enumerate(models))
    steps = pc.get('steps') or []
    shtml = ''.join(f'<li class="plx-step"><span class="plx-step-n">{i:02d}</span><span class="plx-step-t">{_esc(st["title"])}</span><span class="plx-step-d">{_esc(st.get("text") or "")}</span></li>' for i, st in enumerate(steps, 1))
    facts = [('Partners', f'{total:02d}')] + [(g, f'{len(nm):02d}') for g, nm in PARTNERS]
    nsec = iter(range(1, 10))
    tabs = [('directory', 'Directory')] + ([('models', 'Ways to partner')] if models else []) + ([('how', 'How it starts')] if steps else [])
    cl = pc.get('closing') or {}

    body = page_header([('Partners', 'partners.html')], 'Our Partners', _title(pc['hero']), '') + f'''
<div class="plx abx"{_rev(pc)}>
{abx_overview('partners.html', f'{total:02d}', _esc(pc['hero'].get('lead') or ''), facts,
              [('Browse partners <span aria-hidden="true">↓</span>', '#directory'), ('Partner with us <span aria-hidden="true">↗</span>', 'contact.html?topic=Partnership#message')], '', 'Our Partners')}
{abx_tabs(tabs)}
<section id="directory" class="plx-sec py-14 lg:py-16">
  <div class="wrap">{sec_head(f'{next(nsec):02d} / Partner Directory', 'Organisations <span class="sh-soft">we work with.</span>', f'{total} partners', desc=_esc(pc.get('directoryIntro') or '') + ('' if with_logo == total else ' Logos will be added once each partner approves their use.'))}
    <div class="pr-tools mt-8">
      <div class="nw-chips" role="group" aria-label="Filter partners">{chips}</div>
      <label class="pr-search"><span class="sr-only">Search partners</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.3 3.3"/></svg><input id="partner-search" type="search" placeholder="Search partners" autocomplete="off"></label>
    </div>
    <ul id="partner-grid" class="pr-grid mt-6">{cards}
    </ul>
    <p class="pr-empty mt-6 hidden text-[15px] text-ink-mid" role="status">No partners match your search.</p>
  </div>
</section>
{f"""
<section id="models" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(nsec):02d} / Ways to Partner', 'Co-design <span class="sh-soft">change with us.</span>', f'{len(models)} models', desc='Every partnership is shaped around shared goals and the communities we serve.')}
    <ul class="plx-acts abx-models mt-8 lg:mt-10">{mhtml}</ul>
  </div>
</section>""" if models else ''}
{f"""
<section id="how" class="plx-sec py-10 lg:py-14">
  <div class="wrap">{sec_head(f'{next(nsec):02d} / How It Starts', 'From first message <span class="sh-soft">to shared results.</span>', f'{len(steps)} steps')}
    <ol class="plx-steps mt-8 lg:mt-10">{shtml}</ol>
  </div>
</section>""" if steps else ''}
</div>
''' + cta_band(_esc(cl.get('title') or ''), _esc(cl.get('text') or ''),
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
             steps=['Tell us about your organisation and goals', f'We explore fit with our {PILLARS_WORD} pillars together', 'Co-design, launch and report on the work'],
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
    about(); pillars(); projects(); project_details(); home_projects(); home_events(); home_partners(); news(); news_articles(); events(); partners(); involved(); contact()
    print('pages written to', OUT)
