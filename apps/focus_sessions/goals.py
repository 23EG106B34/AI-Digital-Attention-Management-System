"""
Goal-based focus mode — classification layer.

This module does NOT introduce a second blocklist architecture. It is a thin,
goal-aware layer that sits on top of the EXISTING classification system:

  * the existing 12 browsing / app categories (EDUCATION, DEVELOPMENT,
    ENTERTAINMENT, SOCIAL_MEDIA, GAMING, SHOPPING, ...),
  * the existing productivity tiers (PRODUCTIVE / NEUTRAL / DISTRACTING),
  * the existing per-user blocklist stored in ``UserProfile.focus_preferences``.

The browser extension and the desktop agent keep working exactly as before; the
blocklist API additionally reports which categories are blocked *for the active
goal* so the extension's existing Focus Shield overlay can use it.

Honesty note: this is keyword/category matching, not semantic page
understanding. For example ``youtube.com`` is ambiguous — the existing
title/channel heuristics decide, and when they cannot, the code falls back to a
"cannot determine reliably" answer instead of pretending.
"""

# ── The single source of truth for the built-in blocklist defaults ──────────
DEFAULT_BLOCKED_APPS = [
    'steam.exe',
    'discord.exe',
    'spotify.exe',
    'netflix.exe',
    'epicgameslauncher.exe',
    'riotclientux.exe',
    'leagueclient.exe',
    'valorant.exe',
    'csgo.exe',
    'telegram.exe',
    'whatsapp.exe',
    'tiktok.exe',
]

DEFAULT_BLOCKED_DOMAINS = [
    'youtube.com',
    'twitter.com',
    'x.com',
    'reddit.com',
    'instagram.com',
    'facebook.com',
    'netflix.com',
    'tiktok.com',
    'twitch.tv',
]

# Obvious entertainment / social / game destinations. These are the only
# domains a goal profile adds on top of the user's own blocklist.
ENTERTAINMENT_DOMAINS = [
    'netflix.com',
    'primevideo.com',
    'hotstar.com',
    'twitch.tv',
    'tiktok.com',
    '9gag.com',
    'buzzfeed.com',
]

SOCIAL_DOMAINS = [
    'instagram.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'reddit.com',
    'snapchat.com',
    'pinterest.com',
    'tumblr.com',
]

GAME_DOMAINS = [
    'store.steampowered.com',
    'steampowered.com',
    'epicgames.com',
    'roblox.com',
    'miniclip.com',
    'poki.com',
    'crazygames.com',
    'friv.com',
    'chess.com',
    'agar.io',
]

SHOPPING_DOMAINS = [
    'amazon.com',
    'amazon.in',
    'flipkart.com',
    'ebay.com',
    'aliexpress.com',
    'myntra.com',
    'ajio.com',
]

ENTERTAINMENT_APPS = [
    'steam.exe',
    'epicgameslauncher.exe',
    'riotclientux.exe',
    'leagueclient.exe',
    'valorant.exe',
    'csgo.exe',
    'netflix.exe',
    'tiktok.exe',
    'spotify.exe',
    'discord.exe',
]

# Categories (from the existing 12-category taxonomy) that should never be
# treated as allowed work for a study / coding / assignment / learning goal.
OTHER_GOAL_BLOCKED_CATEGORIES = ['ENTERTAINMENT', 'SOCIAL_MEDIA', 'GAMING', 'SHOPPING']

ALL_CATEGORIES = [
    'PRODUCTIVE', 'DEVELOPMENT', 'EDUCATION', 'CREATIVE',
    'COMMUNICATION', 'FINANCE', 'SYSTEM', 'NEWS_READING', 'BROWSER',
    'ENTERTAINMENT', 'SOCIAL_MEDIA', 'GAMING', 'SHOPPING',
]


# ── Goal profiles ───────────────────────────────────────────────────────────
# `allowed_categories` reuses the existing taxonomy. `blocked_categories`
# always inherits the obvious distraction categories.
GOAL_PROFILES = {
    'STUDYING': {
        'label': 'Studying',
        'allowed_categories': ['EDUCATION', 'DEVELOPMENT', 'PRODUCTIVE', 'CREATIVE',
                              'NEWS_READING', 'SYSTEM', 'COMMUNICATION', 'FINANCE'],
        'blocked_categories': OTHER_GOAL_BLOCKED_CATEGORIES,
        'extra_blocked_domains': ENTERTAINMENT_DOMAINS + SOCIAL_DOMAINS + GAME_DOMAINS + SHOPPING_DOMAINS,
        'extra_blocked_apps': ENTERTAINMENT_APPS,
        'question_key': 'question.studying',
        'refresh_question_key': 'refresh.studying',
    },
    'CODING': {
        'label': 'Coding',
        'allowed_categories': ['DEVELOPMENT', 'PRODUCTIVE', 'EDUCATION', 'CREATIVE',
                              'SYSTEM', 'COMMUNICATION', 'FINANCE'],
        'blocked_categories': OTHER_GOAL_BLOCKED_CATEGORIES,
        'extra_blocked_domains': ENTERTAINMENT_DOMAINS + SOCIAL_DOMAINS + GAME_DOMAINS + SHOPPING_DOMAINS,
        'extra_blocked_apps': ENTERTAINMENT_APPS,
        'question_key': 'question.coding',
        'refresh_question_key': 'refresh.coding',
    },
    'ASSIGNMENT': {
        'label': 'Assignment',
        'allowed_categories': ['EDUCATION', 'DEVELOPMENT', 'PRODUCTIVE', 'CREATIVE',
                              'NEWS_READING', 'SYSTEM', 'COMMUNICATION', 'FINANCE'],
        'blocked_categories': OTHER_GOAL_BLOCKED_CATEGORIES,
        'extra_blocked_domains': ENTERTAINMENT_DOMAINS + SOCIAL_DOMAINS + GAME_DOMAINS + SHOPPING_DOMAINS,
        'extra_blocked_apps': ENTERTAINMENT_APPS,
        'question_key': 'question.assignment',
        'refresh_question_key': 'refresh.assignment',
    },
    'ONLINE_LEARNING': {
        'label': 'Online Learning',
        'allowed_categories': ['EDUCATION', 'DEVELOPMENT', 'PRODUCTIVE', 'CREATIVE',
                              'NEWS_READING', 'SYSTEM', 'COMMUNICATION'],
        'blocked_categories': OTHER_GOAL_BLOCKED_CATEGORIES,
        'extra_blocked_domains': ENTERTAINMENT_DOMAINS + SOCIAL_DOMAINS + GAME_DOMAINS + SHOPPING_DOMAINS,
        'extra_blocked_apps': ENTERTAINMENT_APPS,
        'question_key': 'question.learning',
        'refresh_question_key': 'refresh.learning',
    },
    'GAMES': {
        'label': 'Games',
        # The "Games" goal is the one profile that intentionally allows gaming;
        # the obvious distraction categories are still blocked.
        'allowed_categories': ALL_CATEGORIES,
        'blocked_categories': ['SOCIAL_MEDIA', 'SHOPPING'],
        'extra_blocked_domains': SOCIAL_DOMAINS + SHOPPING_DOMAINS,
        'extra_blocked_apps': [],
        'question_key': 'question.games',
        'refresh_question_key': 'refresh.games',
    },
    'OTHER': {
        'label': 'Focus',
        'allowed_categories': ALL_CATEGORIES,
        'blocked_categories': OTHER_GOAL_BLOCKED_CATEGORIES,
        'extra_blocked_domains': ENTERTAINMENT_DOMAINS + SOCIAL_DOMAINS + GAME_DOMAINS,
        'extra_blocked_apps': ENTERTAINMENT_APPS,
        'question_key': 'question.generic',
        'refresh_question_key': 'refresh.generic',
    },
}


def normalize_goal(goal):
    """Returns a valid goal key, defaulting to OTHER for anything unknown."""
    key = str(goal or '').strip().upper()
    return key if key in GOAL_PROFILES else 'OTHER'


def get_goal_profile(goal):
    """Returns the profile dict for a goal (never None)."""
    return GOAL_PROFILES[normalize_goal(goal)]


def merge_unique(*lists):
    """Order-preserving unique merge, used to combine blocklists."""
    out = []
    for lst in lists:
        for item in (lst or []):
            value = str(item).strip().lower()
            if value and value not in out:
                out.append(value)
    return out


def goal_blocklist(goal, user_blocked_domains=None, user_blocked_apps=None):
    """
    Builds the effective blocklist for a goal by combining the user's own
    existing blocklist with the goal profile additions.
    """
    profile = get_goal_profile(goal)
    return {
        'goal': normalize_goal(goal),
        'goal_label': profile['label'],
        'blocked_domains': merge_unique(user_blocked_domains, profile['extra_blocked_domains']),
        'blocked_apps': merge_unique(user_blocked_apps, profile['extra_blocked_apps']),
        'allowed_categories': profile['allowed_categories'],
        'blocked_categories': profile['blocked_categories'],
        'question_key': profile['question_key'],
        'refresh_question_key': profile['refresh_question_key'],
    }


def domain_matches(domain, domain_list):
    """True when `domain` equals or is a subdomain of any entry in `domain_list`."""
    if not domain:
        return False
    d = str(domain).lower().strip()
    for entry in (domain_list or []):
        e = str(entry).lower().strip()
        if not e:
            continue
        if d == e or d.endswith('.' + e):
            return True
    return False


def classify_for_goal(category, productivity_label, domain='', goal='OTHER',
                      user_blocked_domains=None, user_blocked_apps=None):
    """
    Goal-aware verdict for one piece of activity.

    Returns a dict with:
      verdict  : 'BLOCKED' | 'ALLOWED' | 'UNKNOWN'
      reason   : machine reason code (localized in the UI)
      matched  : what matched, for an honest explanation

    Deliberately returns 'UNKNOWN' when there is no reliable signal instead of
    guessing about the meaning of a page.
    """
    profile = get_goal_profile(goal)
    cat = str(category or '').upper().strip()
    tier = str(productivity_label or '').upper().strip()

    if domain and domain_matches(domain, user_blocked_domains):
        return {'verdict': 'BLOCKED', 'reason': 'user_blocklist', 'matched': domain}

    if domain and domain_matches(domain, profile['extra_blocked_domains']):
        return {'verdict': 'BLOCKED', 'reason': 'goal_blocklist', 'matched': domain}

    if cat in profile['blocked_categories']:
        return {'verdict': 'BLOCKED', 'reason': 'category_distracting', 'matched': cat}

    if tier == 'DISTRACTING':
        return {'verdict': 'BLOCKED', 'reason': 'category_distracting', 'matched': tier}

    if cat in profile['allowed_categories']:
        return {'verdict': 'ALLOWED', 'reason': 'category_allowed', 'matched': cat}

    if not cat:
        return {'verdict': 'UNKNOWN', 'reason': 'no_classification', 'matched': ''}

    return {'verdict': 'UNKNOWN', 'reason': 'unknown_category', 'matched': cat}


