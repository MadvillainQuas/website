-- ============================================================================
-- 0179 - SEARCH THE WHOLE SITE (the rail's search box: leagues, teams, players).
--
-- One call, site_search(q), answers a search-as-you-type from the rail: the leagues, the clubs and the
-- players whose name matches what has been typed so far, best matches first.
--
-- SMART MATCHING - what is typed does not have to be the name as it is stored:
--   * a name is FOLDED before it is compared, on both sides: lower case, accents taken off (Lukasz for
--     the Polish L-with-stroke, Zolc for the marks), dots and apostrophes dropped (B.LEAGUE is bleague),
--     hyphens and slashes read as spaces;
--   * what is typed is split into WORDS and each has to be in the name, in ANY ORDER and with any other words
--     between: "michael diggins" finds Michael Ray Diggins Jr, "diggins michael" too - no middle name needed;
--   * a word may be an INITIAL ("m diggins", "M. Diggins") or the start of a word (typing "digg");
--   * a suffix or a particle that was typed (jr, sr, ii, iii, de, van ...) is dropped when other words were
--     typed, so "diggins sr" finds Diggins, and "van berg" finds Berg;
--   * a NICKNAME finds the name it stands for and the other way about (mike / michael, liz / elizabeth, and
--     the spellings the Greek and Slavic leagues use: giannis / yannis / ioannis);
--   * a word may belong to the club instead: "cole newcastle" finds Cole Long of Newcastle Eagles (at least
--     one word has to be the player's own), and "newcastle women" the women's club by its league;
--   * and, when the fuzzy flag is on (the box asks again when it has found next to nothing), a word with ONE
--     typing mistake still matches: a letter wrong, missing, extra or two swapped ("digins", "dggins").
--   A club is also found by its short name, its initials and its other names (sponsors); a player by his
--   other spellings; a league by its initials.
--
-- HOW WELL IT MATCHED (lowest first): 0 the whole thing starts the name; 1 every word starts a word of it;
--   2 every word is somewhere in it (or is a nickname, or belongs to the club); 3 a word with a typo.
--   Within a rank the shorter name first, so "Michael Diggins" comes before "Michael Ray Diggins Jr".
--
-- WHAT MAY BE FOUND is what the site shows anyone: a private league, a members-only league the caller may not
--   see (league_visible, 0139) and everything in them are never returned; a player withheld from the public (an
--   under-18 without consent, player_withheld, 0049) never is, and a player whose latest club is in a league the
--   caller may not see is not either (the club would give the league away). No account id, no email, no birth
--   year: an id and a name, where the page is, and a colour and a crest.
--
-- THE COST is a scan of three small tables (695 clubs, 2,700 players, 48 leagues at the time of writing), and
--   only the rows that contain a word typed (or a nickname of one) are ranked: a few milliseconds. There is no
--   index to keep. If the players ever run to the hundreds of thousands, a trigram index on the folded name is the
--   next step; this contract does not change.
--
--   site_fold(t)                          a name as it is compared
--   site_nicks(w)                         the names a folded word may stand for (or that stand for it)
--   site_close(a, b)                      within one typing mistake
--   site_musts(toks, fuzzy, ctxcap)       the words a row must hold to be worth ranking
--   site_rank(q, toks, v, cx, fuzzy)      null, or 0 - 3 (above), for one spelling (and the club's words)
--   site_search(q, limit, fuzzy)          kind, id, name, slug, sub, league_slug, league_name, colour, logo, short_name
-- ============================================================================

create or replace function public.site_fold(t text)
returns text language sql immutable parallel safe set search_path = public as $$
  select btrim(regexp_replace(
    translate(regexp_replace(lower(coalesce(t, '')), E'[\u0300-\u036f]', '', 'g'), 'àáâãäåçèéêëìíîïðñòóôõöøùúûüýÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĵķĸĺļľłńņňŋōŏőŕŗřśŝşšţťŧũūŭůűųŵŷźżžƒơưǎǐǒǔǖǘǚǜǟǡǧǩǫǭǰǵǹǻȁȃȅȇȉȋȍȏȑȓȕȗșțȟȧȩȫȭȯȱȳ-_/,' || E'.\'’‘`%\\', 'aaaaaaceeeeiiiidnoooooouuuuyyaaaccccddeeeeegggghhiiiiijkkllllnnnnooorrrsssstttuuuuuuwyzzzfouaiouuuuuaagkoojgnaaaeeiioorruusthaeooooy' || '    '),
    '\s+', ' ', 'g'))
$$;

/* nicknames and spellings: every word of a group stands for every other (folded, whole words) */
create or replace function public.site_nicks(w text)
returns text[] language sql immutable parallel safe set search_path = public as $$
  select case w
    when 'abbie' then array['abby','abigail']
    when 'abby' then array['abbie','abigail']
    when 'abigail' then array['abbie','abby']
    when 'alec' then array['aleksandar','aleksander','alex','alexander','alexandra','alexandros','lexi','sandy','xander']
    when 'aleksandar' then array['alec','aleksander','alex','alexander','alexandra','alexandros','lexi','sandy','xander']
    when 'aleksander' then array['alec','aleksandar','alex','alexander','alexandra','alexandros','lexi','sandy','xander']
    when 'alex' then array['alec','aleksandar','aleksander','alexander','alexandra','alexandros','lexi','sandy','xander']
    when 'alexander' then array['alec','aleksandar','aleksander','alex','alexandra','alexandros','lexi','sandy','xander']
    when 'alexandra' then array['alec','aleksandar','aleksander','alex','alexander','alexandros','lexi','sandy','xander']
    when 'alexandros' then array['alec','aleksandar','aleksander','alex','alexander','alexandra','lexi','sandy','xander']
    when 'amanda' then array['mandy']
    when 'andreas' then array['andrew','andy','drew']
    when 'andrew' then array['andreas','andy','drew']
    when 'andy' then array['andreas','andrew','drew']
    when 'ant' then array['anthony','antonios','antonis','antony','tony']
    when 'anthony' then array['ant','antonios','antonis','antony','tony']
    when 'antonios' then array['ant','anthony','antonis','antony','tony']
    when 'antonis' then array['ant','anthony','antonios','antony','tony']
    when 'antony' then array['ant','anthony','antonios','antonis','tony']
    when 'athanasios' then array['thanasis','thanos']
    when 'basil' then array['vasil','vasileios','vasilije','vasilis','vassilis']
    when 'becca' then array['becky','rebecca']
    when 'becky' then array['becca','rebecca']
    when 'bella' then array['isabel','isabella','isabelle','izzy']
    when 'ben' then array['benjamin','benji','benny']
    when 'benjamin' then array['ben','benji','benny']
    when 'benji' then array['ben','benjamin','benny']
    when 'benny' then array['ben','benjamin','benji']
    when 'bert' then array['bob','bobby','rob','robbie','robert']
    when 'beth' then array['betty','elisabeth','eliza','elizabeth','liz','lizzie']
    when 'betty' then array['beth','elisabeth','eliza','elizabeth','liz','lizzie']
    when 'bill' then array['billy','liam','will','william','willy']
    when 'billy' then array['bill','liam','will','william','willy']
    when 'bob' then array['bert','bobby','rob','robbie','robert']
    when 'bobby' then array['bert','bob','rob','robbie','robert']
    when 'cam' then array['cameron']
    when 'cameron' then array['cam']
    when 'cat' then array['catherine','cathy','kat','kate','katherine','kathy','katie']
    when 'catherine' then array['cat','cathy','kat','kate','katherine','kathy','katie']
    when 'cathy' then array['cat','catherine','kat','kate','katherine','kathy','katie']
    when 'charles' then array['charlie','charlotte','chas','chuck','lottie']
    when 'charlie' then array['charles','charlotte','chas','chuck','lottie']
    when 'charlotte' then array['charles','charlie','chas','chuck','lottie']
    when 'chas' then array['charles','charlie','charlotte','chuck','lottie']
    when 'chris' then array['chrissy','christine','christopher','topher']
    when 'chrissy' then array['chris','christine','christopher','topher']
    when 'christine' then array['chris','chrissy','christopher','topher']
    when 'christopher' then array['chris','chrissy','christine','topher']
    when 'chuck' then array['charles','charlie','charlotte','chas','lottie']
    when 'constantine' then array['costas','konstantin','konstantinos','kostas','kostis']
    when 'costas' then array['constantine','konstantin','konstantinos','kostas','kostis']
    when 'dan' then array['daniel','danny']
    when 'dani' then array['danielle']
    when 'daniel' then array['dan','danny']
    when 'danielle' then array['dani']
    when 'danny' then array['dan','daniel']
    when 'dave' then array['davey','david','davy']
    when 'davey' then array['dave','david','davy']
    when 'david' then array['dave','davey','davy']
    when 'davy' then array['dave','davey','david']
    when 'debbie' then array['deborah','debra']
    when 'deborah' then array['debbie','debra']
    when 'debra' then array['debbie','deborah']
    when 'demetrius' then array['dimitri','dimitrije','dimitrios','dimitris','dmitri','dmitry']
    when 'dick' then array['rich','richard','richie','rick','ricky']
    when 'dimitri' then array['demetrius','dimitrije','dimitrios','dimitris','dmitri','dmitry']
    when 'dimitrije' then array['demetrius','dimitri','dimitrios','dimitris','dmitri','dmitry']
    when 'dimitrios' then array['demetrius','dimitri','dimitrije','dimitris','dmitri','dmitry']
    when 'dimitris' then array['demetrius','dimitri','dimitrije','dimitrios','dmitri','dmitry']
    when 'dmitri' then array['demetrius','dimitri','dimitrije','dimitrios','dimitris','dmitry']
    when 'dmitry' then array['demetrius','dimitri','dimitrije','dimitrios','dimitris','dmitri']
    when 'dom' then array['dominic','dominick']
    when 'dominic' then array['dom','dominick']
    when 'dominick' then array['dom','dominic']
    when 'don' then array['donald','donnie']
    when 'donald' then array['don','donnie']
    when 'donnie' then array['don','donald']
    when 'doug' then array['douglas']
    when 'douglas' then array['doug']
    when 'drew' then array['andreas','andrew','andy']
    when 'ed' then array['eddie','edward','ned','ted','teddy','theo','theodore']
    when 'eddie' then array['ed','edward','ned','ted','teddy','theo','theodore']
    when 'edward' then array['ed','eddie','ned','ted','teddy','theo','theodore']
    when 'elisabeth' then array['beth','betty','eliza','elizabeth','liz','lizzie']
    when 'eliza' then array['beth','betty','elisabeth','elizabeth','liz','lizzie']
    when 'elizabeth' then array['beth','betty','elisabeth','eliza','liz','lizzie']
    when 'em' then array['emily','emmy']
    when 'emily' then array['em','emmy']
    when 'emmanouil' then array['emmanuel','manolis','manuel']
    when 'emmanuel' then array['emmanouil','manolis','manuel']
    when 'emmy' then array['em','emily']
    when 'filip' then array['phil','philip','philipp','phillip']
    when 'fred' then array['freddie','freddy','frederick','fredrick']
    when 'freddie' then array['fred','freddy','frederick','fredrick']
    when 'freddy' then array['fred','freddie','frederick','fredrick']
    when 'frederick' then array['fred','freddie','freddy','fredrick']
    when 'fredrick' then array['fred','freddie','freddy','frederick']
    when 'gabby' then array['gabriella','gabrielle']
    when 'gabriella' then array['gabby','gabrielle']
    when 'gabrielle' then array['gabby','gabriella']
    when 'geoff' then array['geoffrey','jeff','jeffrey']
    when 'geoffrey' then array['geoff','jeff','jeffrey']
    when 'george' then array['georgi','georgios','giorgos','yiorgos']
    when 'georgi' then array['george','georgios','giorgos','yiorgos']
    when 'georgios' then array['george','georgi','giorgos','yiorgos']
    when 'gerald' then array['gerry','jeremiah','jeremy','jerry']
    when 'gerry' then array['gerald','jeremiah','jeremy','jerry']
    when 'gianni' then array['giannis','ioannis','jannis','yannis','yiannis']
    when 'giannis' then array['gianni','ioannis','jannis','yannis','yiannis']
    when 'giorgos' then array['george','georgi','georgios','yiorgos']
    when 'greg' then array['gregg','gregory']
    when 'gregg' then array['greg','gregory']
    when 'gregory' then array['greg','gregg']
    when 'hana' then array['hannah']
    when 'hannah' then array['hana']
    when 'ioannis' then array['gianni','giannis','jannis','yannis','yiannis']
    when 'isabel' then array['bella','isabella','isabelle','izzy']
    when 'isabella' then array['bella','isabel','isabelle','izzy']
    when 'isabelle' then array['bella','isabel','isabella','izzy']
    when 'izzy' then array['bella','isabel','isabella','isabelle']
    when 'jack' then array['john','johnny','jon','jonathan','jonny']
    when 'jacob' then array['jake','jakob']
    when 'jake' then array['jacob','jakob']
    when 'jakob' then array['jacob','jake']
    when 'james' then array['jamie','jim','jimmy']
    when 'jamie' then array['james','jim','jimmy']
    when 'jannis' then array['gianni','giannis','ioannis','yannis','yiannis']
    when 'jeff' then array['geoff','geoffrey','jeffrey']
    when 'jeffrey' then array['geoff','geoffrey','jeff']
    when 'jen' then array['jennifer','jenny']
    when 'jennifer' then array['jen','jenny']
    when 'jenny' then array['jen','jennifer']
    when 'jeremiah' then array['gerald','gerry','jeremy','jerry']
    when 'jeremy' then array['gerald','gerry','jeremiah','jerry']
    when 'jerry' then array['gerald','gerry','jeremiah','jeremy']
    when 'jess' then array['jessica','jessie']
    when 'jessica' then array['jess','jessie']
    when 'jessie' then array['jess','jessica']
    when 'jim' then array['james','jamie','jimmy']
    when 'jimmy' then array['james','jamie','jim']
    when 'joe' then array['joey','joseph']
    when 'joey' then array['joe','joseph']
    when 'john' then array['jack','johnny','jon','jonathan','jonny']
    when 'johnny' then array['jack','john','jon','jonathan','jonny']
    when 'jon' then array['jack','john','johnny','jonathan','jonny']
    when 'jonathan' then array['jack','john','johnny','jon','jonny']
    when 'jonny' then array['jack','john','johnny','jon','jonathan']
    when 'joseph' then array['joe','joey']
    when 'josh' then array['joshua']
    when 'joshua' then array['josh']
    when 'kat' then array['cat','catherine','cathy','kate','katherine','kathy','katie']
    when 'kate' then array['cat','catherine','cathy','kat','katherine','kathy','katie']
    when 'katherine' then array['cat','catherine','cathy','kat','kate','kathy','katie']
    when 'kathy' then array['cat','catherine','cathy','kat','kate','katherine','katie']
    when 'katie' then array['cat','catherine','cathy','kat','kate','katherine','kathy']
    when 'ken' then array['kenneth','kenny']
    when 'kenneth' then array['ken','kenny']
    when 'kenny' then array['ken','kenneth']
    when 'konstantin' then array['constantine','costas','konstantinos','kostas','kostis']
    when 'konstantinos' then array['constantine','costas','konstantin','kostas','kostis']
    when 'kostas' then array['constantine','costas','konstantin','konstantinos','kostis']
    when 'kostis' then array['constantine','costas','konstantin','konstantinos','kostas']
    when 'larry' then array['laurence','lawrence']
    when 'laurence' then array['larry','lawrence']
    when 'lawrence' then array['larry','laurence']
    when 'lenny' then array['leo','leonard']
    when 'leo' then array['lenny','leonard']
    when 'leonard' then array['lenny','leo']
    when 'lexi' then array['alec','aleksandar','aleksander','alex','alexander','alexandra','alexandros','sandy','xander']
    when 'liam' then array['bill','billy','will','william','willy']
    when 'liv' then array['livvy','olivia']
    when 'livvy' then array['liv','olivia']
    when 'liz' then array['beth','betty','elisabeth','eliza','elizabeth','lizzie']
    when 'lizzie' then array['beth','betty','elisabeth','eliza','elizabeth','liz']
    when 'lottie' then array['charles','charlie','charlotte','chas','chuck']
    when 'lucas' then array['luka','lukas','lukasz','luke']
    when 'luka' then array['lucas','lukas','lukasz','luke']
    when 'lukas' then array['lucas','luka','lukasz','luke']
    when 'lukasz' then array['lucas','luka','lukas','luke']
    when 'luke' then array['lucas','luka','lukas','lukasz']
    when 'maddie' then array['madeleine','madeline']
    when 'madeleine' then array['maddie','madeline']
    when 'madeline' then array['maddie','madeleine']
    when 'maggie' then array['margaret','marge','meg','peggy']
    when 'mandy' then array['amanda']
    when 'manolis' then array['emmanouil','emmanuel','manuel']
    when 'manuel' then array['emmanouil','emmanuel','manolis']
    when 'marc' then array['marcus']
    when 'marcus' then array['marc']
    when 'margaret' then array['maggie','marge','meg','peggy']
    when 'marge' then array['maggie','margaret','meg','peggy']
    when 'mateusz' then array['matt','matteo','matthew','matty']
    when 'matt' then array['mateusz','matteo','matthew','matty']
    when 'matteo' then array['mateusz','matt','matthew','matty']
    when 'matthew' then array['mateusz','matt','matteo','matty']
    when 'matty' then array['mateusz','matt','matteo','matthew']
    when 'max' then array['maximilian','maximillian']
    when 'maximilian' then array['max','maximillian']
    when 'maximillian' then array['max','maximilian']
    when 'meg' then array['maggie','margaret','marge','peggy']
    when 'michael' then array['mick','mickey','mihail','mikail','mike','mikey','mikhail']
    when 'mick' then array['michael','mickey','mihail','mikail','mike','mikey','mikhail']
    when 'mickey' then array['michael','mick','mihail','mikail','mike','mikey','mikhail']
    when 'mihail' then array['michael','mick','mickey','mikail','mike','mikey','mikhail']
    when 'mikail' then array['michael','mick','mickey','mihail','mike','mikey','mikhail']
    when 'mike' then array['michael','mick','mickey','mihail','mikail','mikey','mikhail']
    when 'mikey' then array['michael','mick','mickey','mihail','mikail','mike','mikhail']
    when 'mikhail' then array['michael','mick','mickey','mihail','mikail','mike','mikey']
    when 'mitch' then array['mitchell']
    when 'mitchell' then array['mitch']
    when 'nat' then array['natalie','nate','nathan','nathaniel']
    when 'natalie' then array['nat','nate','nathan','nathaniel']
    when 'nate' then array['nat','natalie','nathan','nathaniel']
    when 'nathan' then array['nat','natalie','nate','nathaniel']
    when 'nathaniel' then array['nat','natalie','nate','nathan']
    when 'ned' then array['ed','eddie','edward','ted','teddy','theo','theodore']
    when 'nicholas' then array['nick','nicky','nico','nicolai','nicolas','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nick' then array['nicholas','nicky','nico','nicolai','nicolas','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nicki' then array['nicole','nikki']
    when 'nicky' then array['nicholas','nick','nico','nicolai','nicolas','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nico' then array['nicholas','nick','nicky','nicolai','nicolas','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nicolai' then array['nicholas','nick','nicky','nico','nicolas','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nicolas' then array['nicholas','nick','nicky','nico','nicolai','nikola','nikolai','nikolaos','nikolay','nikos']
    when 'nicole' then array['nicki','nikki']
    when 'nikki' then array['nicki','nicole']
    when 'nikola' then array['nicholas','nick','nicky','nico','nicolai','nicolas','nikolai','nikolaos','nikolay','nikos']
    when 'nikolai' then array['nicholas','nick','nicky','nico','nicolai','nicolas','nikola','nikolaos','nikolay','nikos']
    when 'nikolaos' then array['nicholas','nick','nicky','nico','nicolai','nicolas','nikola','nikolai','nikolay','nikos']
    when 'nikolay' then array['nicholas','nick','nicky','nico','nicolai','nicolas','nikola','nikolai','nikolaos','nikos']
    when 'nikos' then array['nicholas','nick','nicky','nico','nicolai','nicolas','nikola','nikolai','nikolaos','nikolay']
    when 'olivia' then array['liv','livvy']
    when 'paddy' then array['pat','patricia','patrick','patty','trish']
    when 'panagiotis' then array['panayiotis','panos']
    when 'panayiotis' then array['panagiotis','panos']
    when 'panos' then array['panagiotis','panayiotis']
    when 'pat' then array['paddy','patricia','patrick','patty','trish']
    when 'patricia' then array['paddy','pat','patrick','patty','trish']
    when 'patrick' then array['paddy','pat','patricia','patty','trish']
    when 'patty' then array['paddy','pat','patricia','patrick','trish']
    when 'paul' then array['pavel','pavle']
    when 'pavel' then array['paul','pavle']
    when 'pavle' then array['paul','pavel']
    when 'peggy' then array['maggie','margaret','marge','meg']
    when 'petar' then array['pete','peter','petros']
    when 'pete' then array['petar','peter','petros']
    when 'peter' then array['petar','pete','petros']
    when 'petros' then array['petar','pete','peter']
    when 'phil' then array['filip','philip','philipp','phillip']
    when 'philip' then array['filip','phil','philipp','phillip']
    when 'philipp' then array['filip','phil','philip','phillip']
    when 'phillip' then array['filip','phil','philip','philipp']
    when 'ray' then array['raymond']
    when 'raymond' then array['ray']
    when 'rebecca' then array['becca','becky']
    when 'rich' then array['dick','richard','richie','rick','ricky']
    when 'richard' then array['dick','rich','richie','rick','ricky']
    when 'richie' then array['dick','rich','richard','rick','ricky']
    when 'rick' then array['dick','rich','richard','richie','ricky']
    when 'ricky' then array['dick','rich','richard','richie','rick']
    when 'rob' then array['bert','bob','bobby','robbie','robert']
    when 'robbie' then array['bert','bob','bobby','rob','robert']
    when 'robert' then array['bert','bob','bobby','rob','robbie']
    when 'ron' then array['ronald','ronnie']
    when 'ronald' then array['ron','ronnie']
    when 'ronnie' then array['ron','ronald']
    when 'sam' then array['samantha','sammy','samuel']
    when 'samantha' then array['sam','sammy','samuel']
    when 'sammy' then array['sam','samantha','samuel']
    when 'samuel' then array['sam','samantha','sammy']
    when 'sandy' then array['alec','aleksandar','aleksander','alex','alexander','alexandra','alexandros','lexi','xander']
    when 'serge' then array['sergei','sergey']
    when 'sergei' then array['serge','sergey']
    when 'sergey' then array['serge','sergei']
    when 'stefan' then array['stefanos','stephan','stephen','steve','steven','stevie']
    when 'stefanos' then array['stefan','stephan','stephen','steve','steven','stevie']
    when 'steph' then array['stephanie']
    when 'stephan' then array['stefan','stefanos','stephen','steve','steven','stevie']
    when 'stephanie' then array['steph']
    when 'stephen' then array['stefan','stefanos','stephan','steve','steven','stevie']
    when 'steve' then array['stefan','stefanos','stephan','stephen','steven','stevie']
    when 'steven' then array['stefan','stefanos','stephan','stephen','steve','stevie']
    when 'stevie' then array['stefan','stefanos','stephan','stephen','steve','steven']
    when 'sue' then array['susan','susie','suzy']
    when 'susan' then array['sue','susie','suzy']
    when 'susie' then array['sue','susan','suzy']
    when 'suzy' then array['sue','susan','susie']
    when 'ted' then array['ed','eddie','edward','ned','teddy','theo','theodore']
    when 'teddy' then array['ed','eddie','edward','ned','ted','theo','theodore']
    when 'thanasis' then array['athanasios','thanos']
    when 'thanos' then array['athanasios','thanasis']
    when 'theo' then array['ed','eddie','edward','ned','ted','teddy','theodore']
    when 'theodore' then array['ed','eddie','edward','ned','ted','teddy','theo']
    when 'thomas' then array['tom','tomas','tomasz','tommy']
    when 'tim' then array['timmy','timothy']
    when 'timmy' then array['tim','timothy']
    when 'timothy' then array['tim','timmy']
    when 'tom' then array['thomas','tomas','tomasz','tommy']
    when 'tomas' then array['thomas','tom','tomasz','tommy']
    when 'tomasz' then array['thomas','tom','tomas','tommy']
    when 'tommy' then array['thomas','tom','tomas','tomasz']
    when 'tony' then array['ant','anthony','antonios','antonis','antony']
    when 'topher' then array['chris','chrissy','christine','christopher']
    when 'tori' then array['vicki','vicky','victoria']
    when 'trish' then array['paddy','pat','patricia','patrick','patty']
    when 'vasil' then array['basil','vasileios','vasilije','vasilis','vassilis']
    when 'vasileios' then array['basil','vasil','vasilije','vasilis','vassilis']
    when 'vasilije' then array['basil','vasil','vasileios','vasilis','vassilis']
    when 'vasilis' then array['basil','vasil','vasileios','vasilije','vassilis']
    when 'vassilis' then array['basil','vasil','vasileios','vasilije','vasilis']
    when 'vicki' then array['tori','vicky','victoria']
    when 'vicky' then array['tori','vicki','victoria']
    when 'victoria' then array['tori','vicki','vicky']
    when 'vince' then array['vincent','vinny']
    when 'vincent' then array['vince','vinny']
    when 'vinny' then array['vince','vincent']
    when 'will' then array['bill','billy','liam','william','willy']
    when 'william' then array['bill','billy','liam','will','willy']
    when 'willy' then array['bill','billy','liam','will','william']
    when 'xander' then array['alec','aleksandar','aleksander','alex','alexander','alexandra','alexandros','lexi','sandy']
    when 'yannis' then array['gianni','giannis','ioannis','jannis','yiannis']
    when 'yiannis' then array['gianni','giannis','ioannis','jannis','yannis']
    when 'yiorgos' then array['george','georgi','georgios','giorgos']
    when 'zac' then array['zach','zachary','zack','zak']
    when 'zach' then array['zac','zachary','zack','zak']
    when 'zachary' then array['zac','zach','zack','zak']
    when 'zack' then array['zac','zach','zachary','zak']
    when 'zak' then array['zac','zach','zachary','zack']
    else '{}'::text[] end
$$;

/* within ONE typing mistake: a letter wrong, missing, extra, or two neighbours swapped (folded words) */
create or replace function public.site_close(a text, b text)
returns boolean language plpgsql immutable parallel safe set search_path = public as $$
declare la integer := char_length(a); lb integer := char_length(b); i integer := 1;
begin
  if abs(la - lb) > 1 then return false; end if;
  if a = b then return true; end if;
  while i <= la and i <= lb and substr(a, i, 1) = substr(b, i, 1) loop i := i + 1; end loop;
  if i > la or i > lb then return true; end if;                  -- one is the other with one more letter at the end
  if la = lb then
    return substr(a, i + 1) = substr(b, i + 1)                                                            -- a letter wrong
        or (i < la and substr(a, i, 1) = substr(b, i + 1, 1) and substr(a, i + 1, 1) = substr(b, i, 1)
            and substr(a, i + 2) = substr(b, i + 2));                                                     -- two swapped
  elsif la = lb + 1 then return substr(a, i + 1) = substr(b, i);                                          -- a letter extra
  else return substr(a, i) = substr(b, i + 1);                                                            -- a letter missing
  end if;
end $$;

/* q: the whole thing typed, folded; toks: its words (suffixes and particles dropped); v: one spelling of a name (raw);
   cx: the club's words, already folded (or ''); fuzzy: forgive one mistake. No queries inside: it is called for
   every row that could match. */
create or replace function public.site_rank(q text, toks text[], v text, cx text default '', fuzzy boolean default false)
returns integer language plpgsql immutable parallel safe set search_path = public as $$
declare
  s text := public.site_fold(v);
  ps text; pc text;
  k text; a text; w text; n integer; t integer; hit boolean;
  worst integer := 1; own integer := 0;
begin
  if s = '' then return null; end if;
  if left(s, char_length(q)) = q then return 0; end if;
  ps := ' ' || s;
  pc := ' ' || coalesce(cx, '');
  foreach k in array toks loop
    t := null;
    if position(' ' || k in ps) > 0 then t := 1; own := own + 1;                       -- the start of a word (an initial is one)
    elsif char_length(k) >= 3 and position(k in s) > 0 then t := 2; own := own + 1;   -- anywhere in the name
    else
      hit := false;
      foreach a in array public.site_nicks(k) loop                                     -- a nickname of a word of it
        if position(' ' || a in ps) > 0 then hit := true; exit; end if;
      end loop;
      if hit then t := 2; own := own + 1;
      elsif position(' ' || k in pc) > 0 then t := 2;                                  -- a word of the club (never on its own)
      elsif fuzzy and char_length(k) >= 4 then                                         -- one mistake, if asked
        n := char_length(k);
        foreach w in array string_to_array(s, ' ') loop
          if public.site_close(k, left(w, n)) or public.site_close(k, left(w, n + 1)) or public.site_close(k, left(w, n - 1)) then
            t := 3; own := own + 1; exit;
          end if;
        end loop;
      end if;
    end if;
    if t is null then return null; end if;
    if t > worst then worst := t; end if;
  end loop;
  if own = 0 then return null; end if;
  return worst;
end $$;

/* The words a row must contain, as alternatives ('mike|michael|mikey'), to be worth ranking at all: every typed word that no
   club (or league) could account for - a club's words are the club's, not the player's. With mistakes forgiven, a word of
   four letters or more may also be found by its first or last two or three letters (one mistake cannot spoil both ends). */
create or replace function public.site_musts(toks text[], fuzzy boolean, ctxcap text)
returns text[] language plpgsql immutable parallel safe set search_path = public as $$
declare k text; alts text[]; out text[] := '{}'; g integer;
begin
  foreach k in array toks loop
    if position(' ' || k in coalesce(ctxcap, '')) > 0 then continue; end if;
    alts := array[k] || public.site_nicks(k);
    if fuzzy and char_length(k) >= 4 then
      g := case when char_length(k) >= 6 then 3 else 2 end;
      alts := alts || left(k, g) || right(k, g);
    end if;
    out := out || array_to_string(alts, '|');
  end loop;
  return out;
end $$;

create or replace function public.site_search(p_q text, p_limit integer default 6, p_fuzzy boolean default false)
returns table (kind text, id uuid, name text, slug text, sub text, league_slug text, league_name text,
               colour text, logo text, short_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  q    text := public.site_fold(left(coalesce(p_q, ''), 60));
  toks text[];
  alts text[];
  musts text[];
  ctxcap text;
  n    integer := greatest(1, least(coalesce(p_limit, 6), 12));
  noise constant text[] := array['jr','sr','jnr','snr','ii','iii','iv','junior','senior',
                                 'de','da','do','dos','das','del','della','di','van','von','der','den','la','le','el','al','bin','ibn'];
begin
  if char_length(q) < 2 then return; end if;
  toks := array_remove(string_to_array(q, ' '), '');
  -- a suffix or a particle is dropped when other words were typed
  if exists (select 1 from unnest(toks) k where k <> all (noise)) then
    toks := array(select k from unnest(toks) k where k <> all (noise));
  end if;
  -- what a row must contain to be worth ranking: every typed word no club could account for (or a nickname of it,
  -- or - forgiving mistakes - the two or three letters at its ends), and at least one typed word in any case
  alts := array(select distinct a from (select unnest(toks) union all select unnest(public.site_nicks(k)) from unnest(toks) k) x(a));

  -- the leagues (sub: the country code, which the page names in the reader's language)
  return query
    select 'league'::text, l.id, l.name::text, l.slug::text, l.country::text, l.slug::text, l.name::text, l.colour_a::text,
           l.logo_path::text, l.initials::text
      from leagues l
      cross join lateral (select min(public.site_rank(q, toks, v, '', p_fuzzy)) as r
                            from unnest(array[l.name, l.initials, l.slug]) v) m
     where m.r is not null and public.league_visible(l.id)
     order by m.r, char_length(l.name), l.name
     limit least(n, 4);

  -- the clubs (sub: none; the league is the line under the name, and its words count: "newcastle women")
  select ' ' || coalesce(string_agg(public.site_fold(l.name), ' '), '') into ctxcap from leagues l;
  musts := public.site_musts(toks, p_fuzzy, ctxcap);
  return query
    with c0 as (
      select t.id, t.slug, t.name, t.short_name, t.colour, t.logo_path, t.initials, t.aliases, l.slug as lslug, l.name as lname, l.id as lid,
             public.site_fold(t.name || ' ' || t.short_name || ' ' || coalesce(t.initials, '') || ' ' || array_to_string(coalesce(t.aliases, '{}'), ' ')) as hay
        from teams t join leagues l on l.id = t.league_id)
    select 'team'::text, c.id, c.name::text, c.slug::text, null::text, c.lslug::text, c.lname::text, c.colour::text,
           c.logo_path::text, c.short_name::text
      from c0 c
      cross join lateral (select min(public.site_rank(q, toks, v, public.site_fold(c.lname), p_fuzzy)) as r
                            from unnest(array[c.name, c.short_name, c.initials] || coalesce(c.aliases, '{}')) v) m
     where not exists (select 1 from unnest(musts) ms where not exists (select 1 from unnest(string_to_array(ms, '|')) a where position(a in c.hay) > 0))
       and (cardinality(musts) > 0 or exists (select 1 from unnest(alts) a where position(a in c.hay) > 0))
       and m.r is not null and public.league_visible(c.lid)
     order by m.r, char_length(c.name), c.name, c.lname
     limit n;

  -- the players (sub: the club he is on now, whose words count: "cole newcastle")
  select ' ' || coalesce(string_agg(public.site_fold(t.name || ' ' || t.short_name || ' ' || l.name), ' '), '') into ctxcap
    from teams t join leagues l on l.id = t.league_id;
  musts := public.site_musts(toks, p_fuzzy, ctxcap);
  return query
    with c0 as (
      select pl.id, pl.slug, pl.first_name, pl.last_name, pl.aliases,
             public.site_fold(pl.first_name || ' ' || pl.last_name || ' ' || array_to_string(coalesce(pl.aliases, '{}'), ' ')) as hay
        from players pl
       where not public.player_withheld(pl.is_minor, pl.public_consent)),
    c1 as (select c.* from c0 c
            where not exists (select 1 from unnest(musts) ms where not exists (select 1 from unnest(string_to_array(ms, '|')) a where position(a in c.hay) > 0))
              and (cardinality(musts) > 0 or exists (select 1 from unnest(alts) a where position(a in c.hay) > 0))),
    cand as (
      select c.id, c.slug, btrim(c.first_name || ' ' || c.last_name) as nm, m.r, cur.tname, cur.tshort, cur.colour, cur.logo, cur.lslug, cur.lname
        from c1 c
        left join lateral (
          select t.name as tname, t.short_name as tshort, t.colour, t.logo_path as logo, l.slug as lslug, l.name as lname,
                 public.league_visible(l.id) as ok
            from roster_entries re
            join teams t   on t.id = re.team_id
            join leagues l on l.id = t.league_id
           where re.player_id = c.id
           order by re.active desc, re.created_at desc
           limit 1) cur on true
        cross join lateral (select min(public.site_rank(q, toks, v,
                                  public.site_fold(coalesce(cur.tname, '') || ' ' || coalesce(cur.tshort, '') || ' ' || coalesce(cur.lname, '')), p_fuzzy)) as r
                              from unnest(array[c.first_name || ' ' || c.last_name] || coalesce(c.aliases, '{}')) v) m
       where m.r is not null and cur.ok is not false        -- no club at all is a free agent; a club in a hidden league is not shown
    )
    select 'player'::text, c.id, c.nm::text, c.slug::text, c.tname::text, c.lslug::text, c.lname::text, c.colour::text, c.logo::text, c.tshort::text
      from cand c
     order by c.r, char_length(c.nm), c.nm
     limit n;
end $$;

alter function public.site_fold(text) owner to postgres;
alter function public.site_nicks(text) owner to postgres;
alter function public.site_close(text, text) owner to postgres;
alter function public.site_musts(text[], boolean, text) owner to postgres;
alter function public.site_rank(text, text[], text, text, boolean) owner to postgres;
alter function public.site_search(text, integer, boolean) owner to postgres;
revoke all on function public.site_fold(text) from public;
revoke all on function public.site_nicks(text) from public;
revoke all on function public.site_close(text, text) from public;
revoke all on function public.site_musts(text[], boolean, text) from public;
revoke all on function public.site_rank(text, text[], text, text, boolean) from public;
revoke all on function public.site_search(text, integer, boolean) from public;
-- the helpers are the search's own (it runs as its owner); only the search is for the site to call
grant execute on function public.site_fold(text) to service_role;
grant execute on function public.site_nicks(text) to service_role;
grant execute on function public.site_close(text, text) to service_role;
grant execute on function public.site_musts(text[], boolean, text) to service_role;
grant execute on function public.site_rank(text, text[], text, text, boolean) to service_role;
grant execute on function public.site_search(text, integer, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- A READ-ONLY CHECK of how a name is folded, matched and ranked
-- ----------------------------------------------------------------------------
do $$
declare bad text;
begin
  if public.site_fold(E'  B.LEAGUE  Premier ') <> 'bleague premier' then bad := 'dots'; end if;
  if public.site_fold('Zoltan-Nagy / O''Neil') <> 'zoltan nagy oneil' then bad := 'hyphen, slash, apostrophe'; end if;
  if public.site_fold(E'Łukasz Żółć') <> 'lukasz zolc' then bad := 'accents: ' || public.site_fold(E'Łukasz Żółć'); end if;
  if public.site_fold('50% off_x') <> '50 off x' then bad := 'wildcards'; end if;
  if public.site_rank('new', array['new'], 'Newcastle Eagles') is distinct from 0 then bad := 'prefix'; end if;
  if public.site_rank('eagles', array['eagles'], 'Newcastle Eagles') is distinct from 1 then bad := 'word start'; end if;
  if public.site_rank('astle', array['astle'], 'Newcastle Eagles') is distinct from 2 then bad := 'anywhere'; end if;
  if public.site_rank('eagles new', array['eagles', 'new'], 'Newcastle Eagles') is distinct from 1 then bad := 'any order'; end if;
  if public.site_rank('michael diggins', array['michael', 'diggins'], 'Michael Ray Diggins Jr') is distinct from 1 then bad := 'a middle name'; end if;
  if public.site_rank('m diggins', array['m', 'diggins'], 'Michael Diggins') is distinct from 1 then bad := 'an initial'; end if;
  if public.site_rank('mike diggins', array['mike', 'diggins'], 'Michael Diggins') is distinct from 2 then bad := 'a nickname'; end if;
  if public.site_rank('cole newcastle', array['cole', 'newcastle'], 'Cole Long', 'newcastle eagles') is distinct from 2 then bad := 'a club word'; end if;
  if public.site_rank('newcastle eagles', array['newcastle', 'eagles'], 'Cole Long', 'newcastle eagles') is not null then bad := 'club words alone are not a player'; end if;
  if public.site_rank('digins', array['digins'], 'Michael Diggins') is not null then bad := 'a typo is not a match unless asked'; end if;
  if public.site_rank('digins', array['digins'], 'Michael Diggins', '', true) is distinct from 3 then bad := 'a typo when asked'; end if;
  if public.site_rank('bristol', array['bristol'], 'Newcastle Eagles') is not null then bad := 'no match'; end if;
  if public.site_musts(array['cole', 'newcastle'], false, ' newcastle eagles slb') <> array['cole'] then bad := 'musts skip a club word'; end if;
  if (public.site_musts(array['mike'], false, ''))[1] not like 'mike|michael%' then bad := 'musts carry nicknames'; end if;
  if (public.site_musts(array['digins'], true, ''))[1] not like '%|dig|ins' then bad := 'musts carry the ends when forgiving'; end if;
  if not public.site_close('diggins', 'digins') or not public.site_close('diggins', 'dgigins') or public.site_close('diggins', 'dagins') then bad := 'close'; end if;
  if not has_function_privilege('anon', 'public.site_search(text, integer, boolean)', 'execute') then bad := 'anon may not search'; end if;
  if has_function_privilege('anon', 'public.site_rank(text, text[], text, text, boolean)', 'execute') then bad := 'anon may call the helpers'; end if;
  if bad is not null then raise exception '0179: %', bad; end if;
  raise notice '0179 ok';
end $$;
