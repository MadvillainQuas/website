"""scripts/ingest/names.py — one shape for a name, whatever the feed calls them.

Every case below is a real form one of the ten leagues actually sends.

    python scripts/ingest/names_test.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import names  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)))


def eq(what, got, want):
    ok(what, got == want, got)


print("\n-- the shapes the feeds send")
eq("Genius sends the two fields already split",
   names.person({"firstName": "Amari", "familyName": "Williams"})[:2], ("Amari", "Williams"))
eq("EuroLeague shouts, family name first",
   names.person({"name": "DONCIC, LUKA"})[:2], ("Luka", "Doncic"))
eq("the ACB writes it the same way without shouting",
   names.person({"name": "Hernangomez, Willy"})[:2], ("Willy", "Hernangomez"))
eq("a plain string in reading order",
   names.person("Elias Valtonen")[:2], ("Elias", "Valtonen"))
eq("one word is a family name, not a forename",
   names.person("Nene")[:2], ("", "Nene"))

print("\n-- alphabets")
eq("Czech diacritics are folded", names.person({"name": "Tomáš Satoranský"})[:2], ("Tomas", "Satoransky"))
eq("Slovak and Serbian too", names.person({"name": "Nikola Jokić"})[:2], ("Nikola", "Jokic"))
eq("Swedish and Norwegian letters NFKD will not split",
   names.person({"name": "Jonas Øverbø"})[:2], ("Jonas", "Overbo"))
eq("Polish", names.person({"name": "Michał Sokołowski"})[:2], ("Michal", "Sokolowski"))
eq("Cyrillic", names.person({"name": "Алексей Швед"})[:2], ("Aleksey", "Shved"))
eq("Greek", names.person({"name": "Γιαννης Παπαγιαννης"})[:2], ("Giannis", "Papagiannis"))
eq("German", names.person({"name": "Maximilian Kleber"})[:2], ("Maximilian", "Kleber"))

print("\n-- Japanese: the Latin field wins, the kanji is kept")
first, last, aliases = names.person({"firstName": "勇樹", "familyName": "富樫",
                                     "internationalFirstName": "Yuki",
                                     "internationalFamilyName": "Togashi"})
eq("the romaji is what is stored", (first, last), ("Yuki", "Togashi"))
ok("the kanji is kept as an alias", any("富樫" in a for a in aliases), aliases)
eq("with no Latin field the kanji is left alone rather than guessed at",
   names.person({"firstName": "勇樹", "familyName": "富樫"})[:2], ("勇樹", "富樫"))

print("\n-- kana are spelt, the way a passport writes a name (the W League's furigana)")
eq("hiragana, word breaks kept", names.kana_romaji("やまもと まい"), "yamamoto mai")
eq("long vowels written once", [names.kana_romaji(k) for k in ("さとう", "おおわき", "とうどう", "ゆうき", "こういち")],
   ["sato", "owaki", "todo", "yuki", "koichi"])
eq("...but not the 'ue' of Inoue", names.kana_romaji("いのうえ"), "inoue")
eq("n before b/m/p is m", [names.kana_romaji(k) for k in ("なんば", "ほんま", "さんぺい", "こんの")],
   ["namba", "homma", "sampei", "konno"])
eq("small kana and the doubling small tsu", [names.kana_romaji(k) for k in ("きょうこ", "しゅり", "ちひろ", "はっとり", "いっち")],
   ["kyoko", "shuri", "chihiro", "hattori", "itchi"])
eq("katakana, and the sounds a foreign name needs",
   [names.kana_romaji(k) for k in ("ディマロ", "ファトゥ", "ジェシカ", "ウォーカー", "ヴィクトリア", "カサンドラ・ブラウン")],
   ["dimaro", "fatu", "jeshika", "woka", "vikutoria", "kasandora buraun"])
eq("kanji is not kana, and comes back untouched", names.kana_romaji("山本 まい"), "山本 mai")
ok("is_kana: a reading is kana, a name in kanji is not",
   names.is_kana("やまもと まい") and names.is_kana("カサンドラ・ブラウン") and not names.is_kana("山本 麻衣"))

print("\n-- Bulgarian: the country's own standard (Transliteration Act 2009), not the Russian table")
for cyr, lat in (("Христо Стоичков", "Hristo Stoichkov"), ("Шумен", "Shumen"), ("Щерев", "Shterev"),
                 ("Лъчезар Тошков", "Lachezar Toshkov"), ("Живков", "Zhivkov"), ("ЖИВКОВ", "ZHIVKOV"),
                 ("Ботев 2012 Враца", "Botev 2012 Vratsa"), ("Миньор 2015", "Minyor 2015"),
                 ("София", "Sofia"), ("Мария Ияна", "Maria Iyana"), ("България", "Bulgaria"),
                 ("Берое-Стара Загора", "Beroe-Stara Zagora"), ("Sesame НБЛ", "Sesame NBL"),
                 ("Georgi Ivanov", "Georgi Ivanov")):
    eq("bulgarian_latin: " + lat, names.bulgarian_latin(cyr), lat)
eq("a whole payload, keys untouched", names.bulgarian_payload({"name": "Левски", "rows": [{"personName": "Иван"}], "n": 3}),
   {"name": "Levski", "rows": [{"personName": "Ivan"}], "n": 3})

print("\n-- Greek: ELOT 743, the passport standard, not letter by letter")
for gr, lat in (("Αντετοκούνμπο", "Antetokounmpo"), ("Σπανούλης", "Spanoulis"), ("Διαμαντίδης", "Diamantidis"),
                ("Ευάγγελος", "Evangelos"), ("Ευθύμιος", "Efthymios"), ("Ναύπλιο", "Nafplio"),
                ("Ταΰγετος", "Taygetos"), ("Γκάλης", "Gkalis"), ("Μπουρούσης", "Bourousis"),
                ("Χαράλαμπος", "Charalampos"), ("Αγγελόπουλος", "Angelopoulos"), ("Ψυχικού", "Psychikou"),
                ("ΠΑΠΑΓΙΑΝΝΗΣ", "PAPAGIANNIS"), ("ΕVERTECH", "EVERTECH"), ("VIKOS ΦALCONS", "VIKOS FALCONS")):
    eq("greek_latin: " + lat, names.greek_latin(gr), lat)
eq("latinise routes Greek through the standard", names.latinise("Ευάγγελος Αγγελόπουλος"), "Evangelos Angelopoulos")

print("\n-- capitalisation a .title() gets wrong")
eq("Mc", names.person({"name": "MCDONALD, JAMES"})[:2], ("James", "McDonald"))
eq("Mac", names.person({"name": "MACDONALD, JAMES"})[:2], ("James", "MacDonald"))
eq("apostrophes", names.person({"name": "O'NEAL, SHAQUILLE"})[:2], ("Shaquille", "O'Neal"))
eq("hyphens", names.person({"name": "SMITH-JONES, KYLE"})[:2], ("Kyle", "Smith-Jones"))
eq("a shouted feed capitalises the leading particle",
   names.person({"name": "VAN DER BERG, JAN"})[:2], ("Jan", "Van der Berg"))
eq("...and leaves the interior ones down", names.person({"name": "DE LA CRUZ, LUIS"})[:2],
   ("Luis", "De la Cruz"))
eq("which is how English-language basketball writes it",
   names.person({"name": "DE COLO, NANDO"})[:2], ("Nando", "De Colo"))
eq("a mixed-case feed is left alone", names.person({"name": "DeAndre Jordan"})[:2], ("DeAndre", "Jordan"))
eq("...including its own particles", names.person({"firstName": "Jan", "familyName": "van der Berg"})[:2],
   ("Jan", "van der Berg"))

print("\n-- full stops, which drop an action in the stint engine")
eq("initials lose their stops", names.person({"name": "K.J. Williams"})[:2], ("K J", "Williams"))
eq("suffixes lose theirs and keep their shape",
   names.person({"name": "Baker Jr."})[:2], ("Baker", "Jr"))
ok("no stored name contains a full stop",
   all("." not in x for x in names.person({"name": "A.J. Smith Jr."})[:2]))

print("\n-- nothing is lost")
f, l, al = names.person({"name": "DONCIC, LUKA", "scoreboardName": "L. DONCIC"})
ok("the shouted original is an alias", "DONCIC, LUKA" in al, al)
ok("so is the scoreboard form", "L. DONCIC" in al, al)
f, l, al = names.person({"name": "Nikola Jokić"})
ok("the native spelling is an alias, so a search for it still finds him", "Nikola Jokić" in al, al)
f, l, al = names.person({"firstName": "Amari", "familyName": "Williams"})
eq("a name that needed nothing has no aliases", al, [])

print("\n-- clubs are not people")
eq("a club keeps its own capitalisation", names.team_name("Žalgiris Kaunas"), "Zalgiris Kaunas")
eq("...and its own words", names.team_name("AS Monaco Basket"), "AS Monaco Basket")
eq("Japanese club names are left as they are", names.team_name("千葉ジェッツ"), "千葉ジェッツ")

print("\n-- the edges")
eq("nothing in, nothing out", names.person("")[:2], ("", ""))
eq("None is not a crash", names.person(None)[:2], ("", ""))
eq("whitespace collapses", names.person({"name": "  Luka   Doncic  "})[:2], ("Luka", "Doncic"))

print("\n-- one club, one row: the sponsor problem")
# Sponsors are part of a club's name across most of Europe, and they change mid-season.
ok("a sponsor on the front is the same club", names.same_club("Baxi Manresa", "Manresa"))
ok("...and on the end", names.same_club("Crvena Zvezda Meridianbet", "Crvena Zvezda"))
ok("...and swapped for another", names.same_club("Casademont Zaragoza", "Basket Zaragoza"))
ok("...and dropped entirely", names.same_club("Valencia Basket", "Valencia"))
ok("a generic word is not what makes a club", names.same_club("CB Gran Canaria", "Gran Canaria"))
ok("two clubs from one city are two clubs",
   not names.same_club("Bristol Flyers", "Bristol Hurricanes"))
ok("a second side is not the first side",
   not names.same_club("Bristol Flyers II", "Bristol Flyers"))
ok("...nor is a women's side the men's",
   not names.same_club("London Lions Women", "London Lions"))
ok("...nor an academy the senior club",
   not names.same_club("Oaklands Wolves Academy", "Oaklands Wolves"))
ok("nothing matches nothing", not names.same_club("", "Manresa"))

print("\n-- a kanji club name is not punctuation")
# latinise() does not romanise CJK script, so a kanji name used to reach club_core()'s tokenizer
# untouched and lose every kanji character to it (re.split on [^0-9a-z]+ treats non-ASCII as pure
# separator noise): "A東京" (Alvark Tokyo) and "A千葉" (Altiri Chiba) both collapsed to
# the single token {"a"}, and two real, different B.LEAGUE clubs came back "the same club wearing
# a different sponsor" (found 2026-09-18).
eq("club_core keeps a kanji run as its own token, not as separator noise",
   names.club_core("A東京"), frozenset({"a", "東京"}))
ok("Alvark Tokyo is not Altiri Chiba -- two real clubs, not one sponsored",
   not names.same_club("A東京", "A千葉"))
ok("...nor is Tokyo Kyoto -- their kanji names even share one character",
   not names.same_club("東京", "京都"))
ok("a club really is itself", names.same_club("A東京", "A東京"))

print("\n-- ...and the platform acts on it")
import feedplatform  # noqa: E402


class FakeSB:
    """Just enough Supabase for Platform.team(): the league's clubs, and a note of every write."""

    def __init__(self, rows):
        self.rows, self.patched, self.inserted = rows, [], []

    def select(self, table, q):
        if table != "teams":
            return []
        if "external_ids->>fiba_livestats=eq." in q or "slug=eq." in q:
            return []
        return self.rows

    def patch(self, table, q, row):
        self.patched.append((q, row))
        return row

    def upsert(self, table, row, on_conflict=None):
        self.inserted.append(row)
        return [{**row, "id": "new"}]


def platform(extra=None):
    rows = [{"id": "t1", "slug": "manresa", "name": "Manresa", "aliases": [], "external_ids": {}, "logo_path": None},
            {"id": "t2", "slug": "bristol-flyers", "name": "Bristol Flyers", "aliases": [], "external_ids": {}, "logo_path": None}]
    if extra:
        rows.append(extra)
    return feedplatform.Platform(FakeSB(rows), dry=False, auto_create=True, log=lambda m: None)


p = platform()
got = p.team("L", {"name": "Baxi Manresa", "code": "BAX"})
eq("a sponsored fixture finds the club that is already there", (got or {}).get("id"), "t1")
ok("...and does not create a second one", not p.sb.inserted, p.sb.inserted)
ok("...and remembers the sponsored form as an alias",
   any("Baxi Manresa" in (row.get("aliases") or []) for _, row in p.sb.patched), p.sb.patched)

p = platform()
got = p.team("L", {"name": "Bristol Flyers II", "code": "BF2"})
ok("a second side is created rather than welded onto the first",
   (got or {}).get("id") != "t2" and len(p.sb.inserted) == 1, ((got or {}).get("id"), p.sb.inserted))

p = platform()
p.team("L", {"name": "Bristol Hurricanes", "code": "BH"})
ok("an unrelated club is still its own club", len(p.sb.inserted) == 1)

p = platform({"id": "t3", "slug": "manresa-basket", "name": "Manresa Basket", "aliases": [],
              "external_ids": {}, "logo_path": None})
got = p.team("L", {"name": "Baxi Manresa", "code": "BAX"})
ok("two clubs that both look like it are left alone rather than guessed between",
   not p.sb.inserted and not p.sb.patched, (got, p.sb.inserted, p.sb.patched))

print("\n-- a club's short_name is never a number nobody can read")
# The Slovak SBL's schedule carries no letter abbreviation at all -- its crest URLs carry only
# the club's own numeric id on that site -- so "code" here is a bare digit string with nothing
# else to key the fixture on. That number used to land straight in short_name, and the embed
# strip's own abbr() (which does not go through EpinoiaInitials) showed it verbatim: a club
# reading "699" on a phone (reported 2026-09-18).
p = platform()
got = p.team("L", {"name": "BK Komarno", "code": "699079"})
eq("a purely numeric code never becomes the short name",
   (got or {}).get("short_name"), "BK Komarno")

p = platform()
got = p.team("L", {"name": "BK Komarno", "code": "KOM"})
eq("...but a real feed abbreviation still does",
   (got or {}).get("short_name"), "KOM")

# bleague.jp's "code" is the crest's FILE NAME, so it arrives all lower case -- and put "AT" and
# "RG" on the strip's cards for every club in both Japanese divisions until a code had to look
# like something a human would print before it could be a short name (2026-09-18).
p = platform()
got = p.team("L", {"name": "Alvark Tokyo", "code": "at"})
eq("an all-lowercase code is a file name, not an abbreviation",
   (got or {}).get("short_name"), "Alvark Tokyo")
p = platform()
got = p.team("L", {"name": "Ryukyu Golden Kings", "code": "rg"})
eq("...so the club's own name is trimmed to fit instead",
   (got or {}).get("short_name"), "Ryukyu")
p = platform()
got = p.team("L", {"name": "Leicester Riders", "code": "LEI"})
eq("...while a printed code keeps the slot it earned",
   (got or {}).get("short_name"), "LEI")

p = platform()
got = p.team("L", {"name": "Patrioti Levice", "code": "699064"})
eq("...and the club's name it falls back to is cut at a WORD boundary, not mid-word",
   (got or {}).get("short_name"), "Patrioti")

print("\n-- team_name(): a shouted club is a name again, a written one is left alone")
eq("Spanish particles stay lower case", names.team_name("ABEJAS DE LEON"), "Abejas de Leon")
eq("...and so does 'del'", names.team_name("DIABLOS ROJOS DEL MEXICO"), "Diablos Rojos del Mexico")
eq("...but a particle that opens the name is capitalised", names.team_name("EL CALOR DE CANCUN"), "El Calor de Cancun")
eq("a university's initials stay capitals", names.team_name("CORRECAMINOS UAT VICTORIA"), "Correcaminos UAT Victoria")
eq("a name with no vowels is an abbreviation", names.team_name("SYNTAINICS MBC"), "Syntainics MBC")
eq("a one-word shouted name", names.team_name("ASTROS"), "Astros")
eq("...unless it is a four-letter abbreviation", names.team_name("CSKA"), "CSKA")
eq("ASVEL keeps the club's own capitals", names.team_name("ASVEL VILLEURBANNE"), "ASVEL Villeurbanne")
eq("a numeral suffix stays a numeral", names.team_name("BRISTOL FLYERS II"), "Bristol Flyers II")
eq("hyphens start a capital", names.team_name("PORTO-ALEGRE"), "Porto-Alegre")
eq("a written name is never touched", names.team_name("BC SLOVAN Bratislava"), "BC SLOVAN Bratislava")
eq("...nor a mixed one with a lower-case word", names.team_name("Panteras de Aguascalientes"), "Panteras de Aguascalientes")
eq("accents go, as before", names.team_name("Žalgiris Kaunas"), "Zalgiris Kaunas")
eq("a shouted name is latinised too", names.team_name("ÁNGELES DE CIUDAD DE MÉXICO"), "Angeles de Ciudad de Mexico")
eq("the same club under both spellings is still one club",
   names.same_club(names.team_name("FRESEROS IRAPUATO"), "Freseros Irapuato"), True)

print("\n-- short_form(): a name cut to fit, never mid-word")
eq("short enough already: untouched", names.short_form("BC Komarno"), "BC Komarno")
eq("one word over the limit: that word alone", names.short_form("Patrioti Levice"), "Patrioti")
eq("keeps whole words as long as they fit", names.short_form("BC SLOVAN Bratislava"), "BC SLOVAN")
eq("a single word longer than the limit still gets cut -- there is no whole word to keep",
   names.short_form("Supercalifragilisticexpialidocious"), "Supercalifra")
eq("empty stays empty", names.short_form(""), "")
eq("collapses whitespace first", names.short_form("  BC   Komarno  "), "BC Komarno")

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
