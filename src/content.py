"""One-off generator for the inner pages in src/pages/.

Run with:  python3 src/content.py
It (re)writes the page sources; build.mjs then wraps them in the shared layout.
Text comes from the homepage and the current afcdfoundation.org site.
Anything AFCD still has to supply is shown as a visible placeholder, never invented.
"""
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
    ('SO-01', 'Strengthen youth leadership and civic participation.', [('Youth Empowerment', 'youth-empowerment')]),
    ('SO-02', 'Advance women’s empowerment and equal opportunities.', [('Women’s Empowerment', 'women-empowerment')]),
    ('SO-03', 'Promote environmental sustainability and climate action.', [('Environment and Climate', 'green-thumbs')]),
    ('SO-04', 'Expand digital inclusion and innovation.', [('Digital Inclusion and Innovation', 'digital-empowerment')]),
    ('SO-05', 'Support entrepreneurship and economic empowerment.', [('Youth Empowerment', 'youth-empowerment'), ('Women’s Empowerment', 'women-empowerment')]),
    ('SO-06', 'Strengthen civil society capacity and inclusive policy dialogue.', []),
]

BENEFICIARIES = ['Young people and students', 'Women and young women', 'Children and adolescents, depending on the programme',
                 'Aspiring entrepreneurs', 'Community initiative leaders', 'Civil society organizations and community associations',
                 'Youth workers', 'Rural and underserved communities']

PILLARS = [
    ('youth-empowerment', '01', 'Youth Empowerment',
     'Support young people in building leadership and civic skills, participating in community life, and developing initiatives that respond to local needs.',
     ['Leadership Lab 2.0', 'Youth First Academy', 'Let’s Dialogue']),
    ('women-empowerment', '02', 'Women’s Empowerment',
     'Strengthen women’s capacities, confidence, and access to learning, leadership and economic opportunities.',
     ['META Skills for Women Empowerment', 'TOT: Gender-based violence']),
    ('green-thumbs', '03', 'Environment and Climate',
     'Promote environmental education, sustainable practices and community climate action, connecting local perspectives with Morocco’s climate priorities.',
     ['Eco Citizen', 'Oxygen', 'Al Haouz Environmental Film Festival', 'Youth Green Generation']),
    ('digital-empowerment', '04', 'Digital Inclusion and Innovation',
     'Improve access to digital knowledge and skills, enabling communities to explore artificial intelligence, science and emerging technologies.',
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


def page(name, title, description, active, body):
    (OUT / name).write_text(
        f'---\ntitle: {title}\ndescription: {description}\nactive: {active}\n---\n<span id="top"></span>\n{body.strip()}\n'
    )


def page_header(crumbs, label, title, lead, extra='', points=()):
    trail = ''.join(
        f'<li><a class="hover:text-ink-pure" href="{href}">{text}</a></li><li aria-hidden="true">/</li>'
        for text, href in crumbs[:-1]
    ) + f'<li aria-current="page" class="text-ink-pure">{crumbs[-1][0]}</li>'
    return f'''
<section class="page-head relative overflow-hidden border-b border-ink-light">
  <div class="wrap pb-14 pt-8 lg:pb-20 lg:pt-12">
    <header class="sh">
      <div class="sh-top">
        <nav aria-label="Breadcrumb" class="text-[13px] text-ink-mid">
          <ol class="flex flex-wrap items-center gap-2"><li><a class="hover:text-ink-pure" href="index.html">Home</a></li><li aria-hidden="true">/</li>{trail}</ol>
        </nav>
        <span class="sh-rule" aria-hidden="true"></span><span class="sh-meta">{label}</span>
      </div>
      <div class="sh-body">
        <h1 class="sh-title sh-xl">{title}</h1>
        <div class="sh-aside"><p class="sh-desc">{lead}</p>{points_html(points)}</div>
      </div>
    </header>{extra}
  </div>
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
    values = ''.join(
        f'<li class="rounded-2xl border border-ink-light bg-white p-6"><span class="text-[11px] tabular-nums text-ink-mid">{r}</span><span class="mt-6 block text-2xl font-semibold tracking-[-0.03em]">{v}</span><span class="mt-2 block text-[14px] leading-relaxed text-ink-dark">{d}</span></li>'
        for r, v, d in VALUES)
    def obj_links(links):
        if not links:
            return '<span class="text-[13px] text-ink-mid">Cross-cutting, all pillars</span>'
        return ''.join(f'<a class="inline-flex min-h-[30px] items-center rounded-full border border-ink-light bg-white px-3 text-[12.5px] font-medium hover:border-ink-pure" href="pillars.html#{slug}">{name}</a>' for name, slug in links)
    objectives = ''.join(f'''
      <li id="{ref.lower()}" class="flex flex-col rounded-3xl border border-ink-light bg-white p-6 md:p-7">
        <span class="inline-flex self-start rounded-full bg-ink-pure px-3 py-1 text-[12px] font-semibold tabular-nums text-white">{ref}</span>
        <span class="mt-5 block text-[19px] font-semibold leading-snug tracking-[-0.015em]">{text}</span>
        <span class="mt-auto flex flex-wrap gap-2 pt-5">{obj_links(links)}</span>
      </li>''' for ref, text, links in OBJECTIVES)
    beneficiaries = ''.join(f'<li class="inline-flex min-h-[38px] items-center rounded-full bg-ink-faint px-4 text-[14px] font-medium">{b}</li>' for b in BENEFICIARIES)
    team = ''.join(f'''
        <li>
          {ph('Team portrait', 'aspect-[4/5] w-full', '#DADADA')}
          <p class="mt-4 text-lg font-medium tracking-[-0.015em]">Team member</p>
          <p class="text-sm text-ink-mid">Role</p>
        </li>''' for _ in range(4))
    body = page_header([('About Us', 'about.html')], 'About Us',
                       'Local roots. <span class="text-ink-mid">Shared purpose.</span> Lasting impact.',
                       'A Moroccan nonprofit association founded in 2007 by young volunteers in Ait Ourir, Al Haouz, with its main office in Marrakech.', points=('Since <b>2007</b>', 'Marrakech', '<b>4</b> Pillars', '<b>6</b> Objectives')) + f'''

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
      <ul class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{values}</ul>
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

<section id="who-we-serve" class="scroll-mt-28 py-14 lg:py-16">
  <div class="wrap">{sec_head('05 / Who We Work With', 'People and places <span class="sh-soft">we serve.</span>', 'Across Morocco', desc='Each programme defines its own participants; not every activity serves every group.')}
    <div class="mt-8 grid gap-4 lg:mt-10 lg:grid-cols-12">
      <div class="rounded-3xl border border-ink-light p-6 md:p-8 lg:col-span-7">
        <p class="label text-ink-mid">Who we work with</p>
        <ul class="mt-5 flex flex-wrap gap-2">{beneficiaries}</ul>
      </div>
      <dl class="grid gap-3 lg:col-span-5">
        <div class="rounded-3xl bg-ink-pure p-6 text-white on-dark md:p-7"><dt class="label text-white/60">Main office</dt><dd class="mt-2 text-xl font-semibold tracking-[-0.02em]">Marrakech, Morocco</dd></div>
        <div class="rounded-3xl border border-ink-light p-6 md:p-7"><dt class="label text-ink-mid">Community roots</dt><dd class="mt-2 text-xl font-semibold tracking-[-0.02em]">Ait Ourir and Al Haouz</dd></div>
        <div class="rounded-3xl border border-ink-light p-6 md:p-7"><dt class="label text-ink-mid">Where we work</dt><dd class="mt-2 text-[15px] leading-relaxed text-ink-dark">Local, regional and national programmes across Morocco. Locations for each programme are listed on its project page. International partners are not AFCD offices.</dd></div>
      </dl>
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
''' + cta_band('Let’s create change together.', 'Join our community, explore opportunities or collaborate with AFCD Foundation.',
               ('Get Involved', 'get-involved.html'), ('Partner With Us', 'get-involved.html#partner'))
    page('about.html', 'About Us · AFCD Foundation',
         'AFCD Foundation’s story, mission, vision, values and team. A Moroccan nonprofit founded in 2007 in Ait Ourir.',
         'about', body)


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
        <div class="grid grid-cols-[110px_1fr] gap-4 border-t border-ink-light py-4"><dt class="label pt-0.5 text-ink-mid">Email</dt><dd><a class="hover:underline" href="mailto:contact@afcdteam.com">contact@afcdteam.com</a></dd></div>
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
