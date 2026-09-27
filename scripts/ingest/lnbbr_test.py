# -*- coding: utf-8 -*-
"""NBB and Liga Ouro from lnb.com.br (adapters/lnbbr.py), offline:

    python scripts/ingest/lnbbr_test.py

What this holds the adapter to:
  * the schedule: every game's league id, Brasilia kick-off in UTC, both clubs with their three-letter codes and crests,
    final only once its report is published, the regular season ("TURNO") and the play-offs apart;
  * the report: the box score (made/attempted, rebounds split, fouls both ways, minutes), the score and quarters, the
    hall; the play-by-play read oldest first, the opening "Entra" lines as the starters, every event translated
    (made and missed shots, a dunk, a free-throw trip numbered, a team rebound and a team turnover without a player,
    a timeout, a drawn foul paired with its foul), and a sentence it does not know kept, not guessed;
  * THE BREAKS: a quarter's five that changed between quarters (not logged) is restated at its start;
  * a fetch with no report yet re-reads the schedule (at most every 30 minutes) and reads the report once it is out.
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from adapters import lnbbr as L  # noqa: E402

PASS = FAIL = 0


def ok(what, cond, saw=None):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  " + what)
    else:
        FAIL += 1
        print("  FAIL  " + what + ("" if saw is None else "  -- saw " + repr(saw)[:400]))


# ------------------------------------------------------------------ a schedule page
def row(rid, date, time_, home, hc, away, ac, link, score=("", ""), rnd=1, stage="1º TURNO"):
    return f"""<tr class="with-hotel">
    <td class="position_value show-for-medium" data-label="JOGO" data-real-id="{rid}">1</td>
    <td class="date_value show-for-medium" data-label="DATA">
        <span class="">{date}</span>
        <span class="">{time_}</span>
    </td>
    <td class="home_team_value show-for-medium" data-label="CASA"><span class="team-shortname">{home}</span></td>
    <td class="logo_home_team show-for-medium"><img alt="" src="https://lnb.com.br/crest/{hc}.png"></td>
    <td class="score_value show-for-medium">X</td>
    <td class="logo_visitor_team show-for-medium"><img alt="" src="https://lnb.com.br/crest/{ac}.png"></td>
    <td class="visitor_team_value show-for-medium" data-label="VISITANTE"><span class="team-shortname">{away}</span></td>
    <td class="hide-for-medium matche_for_small">
        <strong class="small-4 columns float-left">
            {hc} <img alt="" src="https://lnb.com.br/crest/{hc}.png">
        </strong>
        <a href="{link}" class="small-4 medium-12 large-12 float-left match_score_relatorio">
            <span class="home">{score[0]}</span>
            X
            <span class="away">{score[1]}</span>
            <span class="report small-12 medium-12 large-12 float-left">VER RELATÓRIO</span>
        </a>
        <strong class="small-4 columns float-left">
            <img alt="" src="https://lnb.com.br/crest/{ac}.png"> {ac}
        </strong>
    </td>
    <td class="game_value hide_value" data-label="RODADA"><span class="number">{rnd}ª</span> <span class="the-label">RODADA</span></td>
    <td class="stage_value hide_value" data-label="FASE">{stage}</td>
    </tr>"""


REPORT_URL = "https://lnb.com.br/noticias/nbb-caixa-2026-27-vasco-8-x-4-fortaleza/"
SCHEDULE = ("""<div class="large-12" onclick="if (!window.__cfRLUnblockHandlers) return false; BASKET.filterBySeason('106');">
<input type="radio" id="checkbox-season-106" name="season[]" value="106" checked> <label for="checkbox-season-106">NBB 2026/2027</label></div>
<div class="large-12" onclick="if (!window.__cfRLUnblockHandlers) return false; BASKET.filterBySeason('97');">
<input type="radio" id="checkbox-season-97" name="season[]" value="97" > <label for="checkbox-season-97">NBB 2025/2026</label></div><table>"""
            + row("27110", "17/10/2026", "16:00", "Mogi Basquete", "MOG", "Corinthians", "COR",
                  "https://lnb.com.br/partidas/nbb-2026-2027-mogi-basquete-x-corinthians-17102026-1600/")
            + row("27111", "18/10/2026", "20:00", "Vasco da Gama", "VAS", "Fortaleza Basquete Cearense", "FOR", REPORT_URL, ("8", "4"))
            + row("27500", "20/04/2027", "19:30", "Vasco da Gama", "VAS", "Corinthians", "COR",
                  "https://lnb.com.br/noticias/nbb-caixa-2026-27-vasco-80-x-70-corinthians/", ("80", "70"), 1, "QUARTAS")
            + "</table>")

print("-- the schedule")
menu = L.season_menu(SCHEDULE)
ok("the season filter, the current season checked", menu == [("106", "NBB 2026/2027", True), ("97", "NBB 2025/2026", False)], menu)
rows = {r["id"]: r for r in L.schedule_rows(SCHEDULE)}
r = rows["27110"]
ok("a game: its id, both clubs and their codes, 16:00 in Brasilia = 19:00 UTC", r["home"] == "Mogi Basquete" and r["away"] == "Corinthians"
   and r["home_code"] == "MOG" and r["away_code"] == "COR" and r["tip"] == "2026-10-17T19:00:00Z", r)
ok("...its crests, round and stage; no report yet", r["home_logo"].endswith("/MOG.png") and r["away_logo"].endswith("/COR.png")
   and r["round"] == 1 and r["stage"] == "1º TURNO" and not r["report"] and r["score"] is None, r)
ok("a played game links its report and carries its score", rows["27111"]["report"] and rows["27111"]["score"] == (8, 4), rows["27111"])
ok("the play-offs' stage is read", rows["27500"]["stage"] == "QUARTAS")


# ------------------------------------------------------------------ a report page
def ev(q, t, clock, pts, title, text):
    return (f'<div class="move_action large-12 small-12 medium-12 float-left" idq="{q}" idt="{t}">'
            f'<div class="large-2 small-4 medium-2 columns move_action_time"><strong class="quarter">{q}</strong> <br />'
            f'<strong class="time">{clock}</strong> <br /><strong class="points">{pts}</strong></div>'
            f'<div class="large-10 small-8 medium-10 columns move_action_content move_action_content_one">'
            f'<div class="move_action_content_text"><strong class="">{title}</strong><p class="">{text}<br /><strong></strong></p></div></div></div>')


def box_row(shirt, name, mins, pts, reb, ast, p3, p2, ft, stl=0, blk=0, pf=0, fo=0, tov=0):
    cells = [f"#{shirt}", name, "1", mins, pts, reb, str(ast), p3, p2, ft, str(stl), str(blk), f"{pf}.00", f"{fo}.00", str(tov), "0", "0", "5"]
    return ("<tr>" + f'<td class="headcol-2">{cells[0]}</td><td class="headcol">{cells[1]}</td>'
            + "".join(f'<td data-sort-value="0">\n            {c}            </td>' for c in cells[2:]) + "</tr>")


def team_row(mins, pts, reb, ast, p3, p2, ft, stl, blk, pf, fo, tov):
    cells = ["Equipe", "1", mins, pts, reb, str(ast), p3, p2, ft, str(stl), str(blk), f"{pf}.00", f"{fo}.00", str(tov), "0", "0", "0"]
    return "<tr>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>"


def dot(idj, q, t, cls, top, left, clock):
    return (f'<li idj="{idj}" idp="{q}" ide="{t}" class="{cls}" style="top: {top}%; left:{left}%;" time="{clock}" action-type="">'
            '<img src="https://lnb.com.br/wp-content/themes/lnb-2016/images/x_azul-50x50.png" style="width: 36px;">\'</li>')


def chart(left, dots, right):
    """The #graphic tab: each club's players beside the court (as the play-by-play names them), the dots NEWEST first."""
    who = lambda ps: "".join(f'<li idj="{i}"  avatar="https://lnb.com.br/a/{i}.png"><div class="number">#{n}</div>'
                             f'<div class="name">{name}</div></li>' for i, n, name in ps)
    return ('<div class="tabs-panel" id="graphic"><div class="quadra columns"><div class="large-2 columns">'
            '<div class="players_block players_block_left"><ul><strong class="title">Titulares</strong>' + who(left) + '</ul></div></div>'
            '<div class="large-8 columns"><div class="graphic_gym"><img src="https://lnb.com.br/quadra-lnb.jpg" alt="" /><ul>'
            + "".join(dot(*d) for d in reversed(dots)) + '</ul></div></div><div class="large-2 columns">'
            '<div class="players_block players_block_right"><ul><strong class="title">Titulares</strong>' + who(right) + '</ul></div></div></div></div>')


HEAD = ["Nr.", "Jogador", "JO", "Min", "Pts", "RD+RO RT", "AS", "3P%", "2P%", "LL%", "BR", "TO", "FC", "FR", "ER", "EN", "+/-", "EF"]
THEAD = "<thead><tr>" + "".join(f"<th>{h}</th>" for h in HEAD) + "</tr></thead>"
VAS = ["Ale", "G. Basílio", "Pedro Nunes", "Magna", "Honorato", "Elias"]
FOR = ["Gohlke", "Da Silva", "Salsamendi", "Dupree", "Popovic", "Jeanzinho"]
# the whole game, OLDEST first (the page is written newest first below)
PLAY = [
    (1, 2, "10:00", "0 x 0", "INÍCIO DE QUARTO", "Início de partida."),
    *[(1, 1, "10:00", "0 x 0", "Substituição", f"Entra {n}") for n in VAS[:5]],
    *[(1, 2, "10:00", "0 x 0", "Substituição", f"Entra {n}") for n in FOR[:5]],
    (1, 1, "09:40", "2 x 0", "+2 PONTOS", "Pedro Nunes acerta arremesso de dois pontos."),
    (1, 1, "09:40", "2 x 0", "ASSISTÊNCIA", "Assistência do Ale"),
    (1, 2, "09:20", "2 x 0", "Tentativa para três pontos", "Gohlke erra tentativa para três pontos."),
    (1, 2, "09:18", "2 x 0", "REBOTE OFENSIVO", "Fortaleza Basquete Cearense pega rebote ofensivo."),
    (1, 2, "09:00", "2 x 3", "É DE TRÊS!", "É de três! Dupree acerta arremesso de três pontos."),
    (1, 1, "08:40", "2 x 3", "FALTA", "Magna comete falta."),
    (1, 2, "08:40", "2 x 3", "Falta sofrida", "Popovic sofre falta."),
    (1, 2, "08:40", "2 x 4", "+1 PONTO", "Popovic acerta o lance livre."),
    (1, 2, "08:40", "2 x 4", "Lance Livre Errado", "Popovic erra o lance livre."),
    (1, 1, "08:39", "2 x 4", "REBOTE DEFENSIVO", "Honorato pega rebote defensivo."),
    (1, 1, "05:00", "2 x 4", "TEMPO TÉCNICO", "Técnico da equipe Vasco da Gama pede tempo."),
    (1, 1, "05:00", "2 x 4", "Substituição", "Sai Honorato"),
    (1, 1, "05:00", "2 x 4", "Substituição", "Entra Elias"),
    (1, 1, "03:00", "4 x 4", "CRAVADA!", "Cravada!Elias acerta enterrada."),
    (1, 2, "02:00", "4 x 4", "Violação", "Estouro dos 24s."),
    (1, 2, "01:00", "4 x 4", "Erro", "Gohlke perde posse de bola."),
    (1, 1, "01:00", "4 x 4", "Bola recuperada", "Magna recupera a bola."),
    (1, 2, "00:50", "4 x 4", "TOCO!", "Salsamendi dá um toco."),
    (1, 2, "00:30", "4 x 4", "Violação", "Da Silva comete violação de saída de quadra."),
    (1, 2, "00:00", "4 x 4", "FIM DE QUARTO", "Fim do primeiro quarto."),
    # the second quarter: Honorato is back for Vasco and Jeanzinho on for Fortaleza - neither change was logged
    (2, 2, "10:00", "4 x 4", "INÍCIO DE QUARTO", "Início do segundo quarto."),
    (2, 1, "09:30", "6 x 4", "+2 PONTOS", "Honorato acerta arremesso de dois pontos."),
    (2, 2, "09:10", "6 x 4", "Tentativa para dois pontos", "Jean Lucas erra tentativa para dois pontos."),   # the box score's Jeanzinho
    (2, 1, "09:05", "6 x 4", "REBOTE DEFENSIVO", "Ale pega rebote defensivo."),
    (2, 1, "08:00", "6 x 4", "Substituição", "Sai Elias"),
    (2, 1, "08:00", "6 x 4", "Substituição", "Entra Magna"),
    (2, 2, "07:00", "6 x 4", "ALGO NOVO", "Dupree faz algo que ninguém escreveu."),
    (2, 1, "06:30", "6 x 4", "Tentativa para dois pontos", "G. Basílio erra tentativa para dois pontos."),
    (2, 1, "06:28", "6 x 4", "REBOTE OFENSIVO", "G. Basílio pega rebote ofensivo."),
    (2, 1, "06:28", "8 x 4", "+2 PONTOS", "G. Basílio acerta arremesso de dois pontos."),
    (2, 1, "00:00", "8 x 4", "FIM DE QUARTO", "Fim do segundo quarto."),
    (2, 2, "00:00", "8 x 4", "FIM DE PARTIDA", "Fim de partida."),
]
DOTS = [
    (101, 1, 1, "2pt correct", 30.0, 20.0, "09:40"),      # Pedro Nunes: 4.9 m from the rim, mid-range
    (201, 1, 2, "3pt incorrect", 10.0, 70.0, "09:20"),    # Gohlke
    (204, 1, 2, "3pt correct", 95.0, 88.0, "09:00"),      # Dupree, from the corner
    (205, 1, 2, "ll correct", "", "", "08:40"),           # Popovic's free throws: no place
    (205, 1, 2, "ll incorrect", "", "", "08:40"),
    (106, 1, 1, "2pt correct", 52.1, 7.3, "03:00"),       # Elias's dunk, half a metre off the ring
    (105, 2, 1, "2pt correct", 60.0, 80.0, "09:30"),      # Honorato: 4.2 m, mid-range
    (206, 2, 2, "2pt incorrect", 45.0, 91.0, "09:10"),    # Jean Lucas (the box score's Jeanzinho): 1.1 m, at the rim
    (103, 2, 1, "2pt incorrect", 42.0, 9.5, "06:30"),     # G. Basílio: 1.6 m, mid-range
    (103, 2, 1, "2pt correct", 50, 6, "06:28"),           # ...and his tap-in on the ring itself, after his own rebound
]
CHART = chart([(101, 11, "Pedro Nunes"), (102, 9, "Ale"), (103, 10, "G. Basílio"), (104, 20, "Magna"), (105, 5, "Honorato"), (106, 7, "Elias")],
              DOTS, [(201, 4, "Gohlke"), (202, 8, "Da Silva"), (203, 6, "Salsamendi"), (204, 11, "Dupree"), (205, 12, "Popovic"), (206, 0, "Jean Lucas")])
REPORT = ("""<div class="score_header large-12 small-12 medium-12 columns">
<div class="float-left text-right"><span class="show-for-large">Vasco da Gama</span><span class="hide-for-large">VAS</span>
<img src="https://lnb.com.br/crest/VAS.png" alt="" /><strong id="home_score">8</strong></div><div class="float-left vs">x</div>
<div class="float-right text-left"><strong id="away_score">4</strong><img src="https://lnb.com.br/crest/FOR.png" alt="" />
<span class="show-for-large">Fortaleza Basquete Cearense</span><span class="hide-for-large">FOR</span></div></div>
<div class="score_for_quarter">
<div class="quarter"><div class="numbers numbers_home" id="home_quarter_1"><strong>4</strong></div><div class="center"><div class="quarter_time">1ºQ</div></div>
<div class="numbers numbers_away" id="away_quarter_1"><strong>4</strong></div></div>
<div class="quarter"><div class="numbers numbers_home" id="home_quarter_2"><strong>4</strong></div><div class="center"><div class="quarter_time">2ºQ</div></div>
<div class="numbers numbers_away" id="away_quarter_2"><strong>0</strong></div></div></div>
<p class="score_header_place">Ginásio de São Januário</p>"""
          + '<div id="team_home_stats"><table>' + THEAD + "<tbody>"
          + box_row(11, "Pedro Nunes", "20.0", "2/2 (100)", "0+0 0", 0, "0/0 (0)", "1/1 (100)", "0/0 (0)")
          + box_row(9, "Ale", "20.0", "0/0 (0)", "1+0 1", 1, "0/0 (0)", "0/0 (0)", "0/0 (0)")
          + box_row(10, "G. Basílio", "20.0", "2/2 (100)", "0+1 1", 0, "0/0 (0)", "1/2 (50)", "0/0 (0)")
          + box_row(20, "Magna", "18.0", "0/0 (0)", "0+0 0", 0, "0/0 (0)", "0/0 (0)", "0/0 (0)", stl=1, pf=1)
          + box_row(5, "Honorato", "15.0", "2/2 (100)", "1+0 1", 0, "0/0 (0)", "1/1 (100)", "0/0 (0)")
          + box_row(7, "Elias", "7.0", "2/2 (100)", "0+0 0", 0, "0/0 (0)", "1/1 (100)", "0/0 (0)")
          + team_row("0.0", "8/8 (100)", "2+1 3", 1, "0/0 (0)", "4/5 (80)", "0/0 (0)", 1, 0, 1, 0, 0)
          + "</tbody></table></div>"
          + '<div id="team_away_stats"><table>' + THEAD + "<tbody>"
          + box_row(4, "Gohlke", "20.0", "0/3 (0)", "0+0 0", 0, "0/1 (0)", "0/0 (0)", "0/0 (0)", tov=1)
          + box_row(8, "Da Silva", "20.0", "0/0 (0)", "0+0 0", 0, "0/0 (0)", "0/0 (0)", "0/0 (0)", tov=1)
          + box_row(6, "Salsamendi", "20.0", "0/0 (0)", "0+0 0", 0, "0/0 (0)", "0/0 (0)", "0/0 (0)", blk=1)
          + box_row(11, "Dupree", "20.0", "3/3 (100)", "0+0 0", 0, "1/1 (100)", "0/0 (0)", "0/0 (0)")
          + box_row(12, "Popovic", "10.0", "1/1 (100)", "0+0 0", 0, "0/0 (0)", "0/0 (0)", "1/2 (50)", fo=1)
          + box_row(0, "Jeanzinho", "10.0", "0/2 (0)", "0+0 0", 0, "0/0 (0)", "0/1 (0)", "0/0 (0)")
          + team_row("0.0", "4/9 (44)", "0+1 1", 0, "1/2 (50)", "0/1 (0)", "1/2 (50)", 0, 1, 0, 1, 3)
          + "</tbody></table></div>"
          + "".join(ev(*p) for p in reversed(PLAY))
          + CHART)
FIX = {"home": "Vasco da Gama", "away": "Fortaleza Basquete Cearense", "home_code": "VAS", "away_code": "FOR", "url": REPORT_URL,
       "tip": "2026-10-18T23:00:00Z"}

print("\n-- the report")
raw = L.raw_from_report(REPORT, FIX)
h, a = raw["tm"]["1"], raw["tm"]["2"]
ok("both clubs, under the schedule's names and codes, with the score and quarters", h["name"] == "Vasco da Gama" and h["code"] == "VAS"
   and a["code"] == "FOR" and h["score"] == 8 and a["score"] == 4 and (h["p1_score"], h["p2_score"], a["p1_score"], a["p2_score"]) == (4, 4, 4, 0))
ok("the hall", raw["lnbbr"]["venue"] == "Ginásio de São Januário")
pn = h["pl"]["pedro-nunes-11"]
ok("a box line: two-pointers made/attempted, minutes, points", pn["sTwoPointersMade"] == 1 and pn["sTwoPointersAttempted"] == 1
   and pn["sPoints"] == 2 and pn["sMinutes"] == "20:00", pn)
ok("...a player is his display name and shirt within his club", sorted(h["pl"]) == ["ale-9", "elias-7", "g-basilio-10", "honorato-5", "magna-20", "pedro-nunes-11"], sorted(h["pl"]))
ok("...rebounds split defensive + offensive, fouls committed and drawn, free throws", h["pl"]["honorato-5"]["sReboundsDefensive"] == 1
   and h["pl"]["magna-20"]["sFoulsPersonal"] == 1 and a["pl"]["popovic-12"]["sFoulsOn"] == 1 and a["pl"]["popovic-12"]["sFreeThrowsAttempted"] == 2)
ok("...the club's own row beyond its players: a team rebound, a team turnover (the shot clock)", a["tot_sReboundsTeamOffensive"] == 1 and a["tot_sReboundsTeam"] == 1
   and a["tot_sTurnoversTeam"] == 1 and h["tot_sReboundsTeam"] == 0 and h["tot_sTurnoversTeam"] == 0, (a.get("tot_sReboundsTeam"), a.get("tot_sTurnoversTeam")))
st = raw["lnbbr"]["starters"]
ok("the starters are the opening Entra lines", sorted(st["1"]) == ["ale-9", "g-basilio-10", "honorato-5", "magna-20", "pedro-nunes-11"]
   and sorted(st["2"]) == ["da-silva-8", "dupree-11", "gohlke-4", "popovic-12", "salsamendi-6"], st)
ok("...flagged on the players, and not written as substitutions", pn["starter"] == 1 and h["pl"]["elias-7"]["starter"] == 0
   and not any(e["actionType"] == "substitution" and e["period"] == 1 and e["gt"] == "10:00" for e in raw["pbp"]))
P = raw["pbp"]
kinds = [(e["actionType"], e["subType"], e["tno"], e["pno"]) for e in P]
ok("oldest first: the game starts with its first period and ends with the game's end", kinds[0][:2] == ("period", "start") and kinds[-1][:2] == ("game", "end"))
ok("a made two, its assist; a missed three; a made three", ("2pt", "", 1, "pedro-nunes-11") in kinds and ("assist", "", 1, "ale-9") in kinds
   and any(e["actionType"] == "3pt" and not e["success"] and e["pno"] == "gohlke-4" for e in P) and any(e["actionType"] == "3pt" and e["success"] and e["pno"] == "dupree-11" for e in P))
ok("a dunk is a made two, subType dunk", any(e["actionType"] == "2pt" and e["subType"] == "dunk" and e["success"] and e["pno"] == "elias-7" for e in P))
ft = [e for e in P if e["actionType"] == "freethrow"]
ok("a free-throw trip is numbered 1of2, 2of2, made then missed", [(e["subType"], e["success"]) for e in ft] == [("1of2", 1), ("2of2", 0)], [(e["subType"], e["success"]) for e in ft])
ok("a team rebound, a team turnover (shot clock) and a timeout carry no player", ("rebound", "offensive", 2, "") in kinds
   and ("turnover", "shotclock", 2, "") in kinds and ("timeout", "full", 1, "") in kinds, [k for k in kinds if not k[3]])
ok("turnover, steal, block, stepping out", ("turnover", "ballhandling", 2, "gohlke-4") in kinds and ("steal", "", 1, "magna-20") in kinds
   and ("block", "", 2, "salsamendi-6") in kinds and ("turnover", "outofbounds", 2, "da-silva-8") in kinds)
foul = next(e for e in P if e["actionType"] == "foul")
drawn = next(e for e in P if e["actionType"] == "foulon")
ok("a drawn foul points at the foul it mirrors", drawn.get("previousAction") == foul["actionNumber"] and foul["pno"] == "magna-20", (drawn, foul["actionNumber"]))
ok("the running score is on every event", P[-1]["s1"] == "8" and P[-1]["s2"] == "4" and all("s1" in e for e in P))
ok("...and the play-by-play's points are the box score's", raw["lnbbr"]["pbp_points"] == {"1": 8, "2": 4}, raw["lnbbr"]["pbp_points"])
ok("a name the box score does not have ('Jean Lucas') is the box line its plays add up to (Jeanzinho's: one missed two)",
   raw["lnbbr"]["renamed"] == {"2:jean lucas": "jeanzinho-0"} and ("2pt", "", 2, "jeanzinho-0") in kinds, raw["lnbbr"]["renamed"])
ok("a sentence it does not know is kept, not guessed", raw["lnbbr"]["unknown"] == ["ALGO NOVO|Dupree faz algo que ninguém escreveu."], raw["lnbbr"]["unknown"])

print("\n-- the break")
q2 = [e for e in P if e["period"] == 2 and e.get("inferred")]
ok("the changes made between quarters are restated at the second quarter's start: Honorato for Magna (she comes back on "
   "at 8:00, so she was off), Jeanzinho for Popovic (the four who played 20 minutes stay on)",
   [(e["tno"], e["subType"], e["pno"], e["gt"]) for e in q2] == [(1, "out", "magna-20", "10:00"), (1, "in", "honorato-5", "10:00"),
                                                                (2, "out", "popovic-12", "10:00"), (2, "in", "jeanzinho-0", "10:00")],
   [(e["tno"], e["subType"], e["pno"]) for e in q2])
on = {1: set(raw["lnbbr"]["starters"]["1"]), 2: set(raw["lnbbr"]["starters"]["2"])}
offcourt = []
for e in P:
    if e["actionType"] == "substitution":
        (on[e["tno"]].add if e["subType"] == "in" else on[e["tno"]].discard)(e["pno"])
    elif e.get("pno") and e["pno"] not in on[e["tno"]]:
        offcourt.append((e["period"], e["gt"], e["pno"]))
    if any(len(on[t]) != 5 for t in (1, 2)) and e["actionType"] != "substitution":
        offcourt.append(("count", e["period"], e["gt"]))
ok("...so every play is by a player on court, and every club always has five", not offcourt, offcourt)

print("\n-- the shot chart: where each shot was taken")
ch_dots, ch_names = L.shot_chart(REPORT)
ok("the dots are read oldest first, free throws without a place", [(d["q"], d["clock"], d["kind"], d["made"]) for d in ch_dots][:4]
   == [(1, "09:40", "2pt", 1), (1, "09:20", "3pt", 0), (1, "09:00", "3pt", 1), (1, "08:40", "ll", 1)]
   and ch_dots[3]["x"] is None and (ch_dots[0]["x"], ch_dots[0]["y"]) == (20.0, 30.0), ch_dots[:4])
ok("...and the players beside the court, by the site's id, named as the play-by-play names them", ch_names[1]["103"] == "G. Basílio"
   and ch_names[2]["206"] == "Jean Lucas" and len(ch_names[1]) == 6 and len(ch_names[2]) == 6, ch_names)
ok("every shot of the play-by-play has its place", raw["lnbbr"]["shots"] == {"placed": 8, "unplaced": 0, "putbacks": 1}, raw["lnbbr"]["shots"])
by_an = {e["actionNumber"]: e for e in P}
hs_ = {s_["actionNumber"]: s_ for s_ in h["shot"]}
pn_shot = next(e for e in P if e["actionType"] == "2pt" and e["pno"] == "pedro-nunes-11")
ok("...on its club, joined to its action by number (the rim split looks a shot's place up by it)",
   hs_[pn_shot["actionNumber"]]["x"] == 20.0 and hs_[pn_shot["actionNumber"]]["y"] == 30.0 and hs_[pn_shot["actionNumber"]]["pno"] == "pedro-nunes-11"
   and len(h["shot"]) == 5 and len(a["shot"]) == 3 and all(by_an[s_["actionNumber"]]["tno"] == 1 for s_ in h["shot"]), h["shot"][:2])
tap = next(e for e in P if e["actionType"] == "2pt" and e["success"] and e["pno"] == "g-basilio-10")
ok("a shot on the ring itself right after its own club's offensive rebound is a putback",
   tap["subType"] == "putback" and hs_[tap["actionNumber"]]["subType"] == "putback", tap)
ok("...the miss before it is not, and the dunk stays a dunk", [e["subType"] for e in P if e["actionType"] == "2pt" and e["pno"] in ("g-basilio-10", "elias-7")]
   == ["dunk", "", "putback"], [e["subType"] for e in P if e["actionType"] == "2pt" and e["pno"] in ("g-basilio-10", "elias-7")])
from adapters.fiba_livestats import FibaLiveStatsAdapter  # noqa: E402
zones = FibaLiveStatsAdapter._shots(h, a)
ok("so the rim and mid-range split: Vasco 2 of 2 at the rim (the dunk, the tap), 2 of 3 mid-range; Fortaleza 0 of 1 at the rim, 1 of 2 threes",
   zones == {"home": {"rim": {"att": 2, "made": 2}, "mid": {"att": 3, "made": 2}, "three": {"att": 0, "made": 0}},
             "away": {"rim": {"att": 1, "made": 0}, "mid": {"att": 0, "made": 0}, "three": {"att": 2, "made": 1}}}, zones)
from translate.fiba_events import translate as to_events  # noqa: E402
stream = to_events(raw)["events"]
loc_of = {e_["payload"]["ref"]: e_["payload"] for e_ in stream if e_["t"] == "loc"}
twos = [e_ for e_ in stream if e_["t"] in ("p2_made", "p2_miss")]
ok("...and the game stream places every two (a putback on the ring keeps its place and says so)", len(twos) == 6
   and all(e_["seq"] in loc_of for e_ in twos) and any(e_["t"] == "stype" and e_["payload"]["v"] == "putback" for e_ in stream), len(twos))


def sh(gt, at, sub, tno, ok_=0, pno="", q=3):
    return {"period": q, "periodType": "REGULAR", "gt": gt, "actionType": at, "subType": sub, "tno": tno, "success": ok_, "pno": pno}


PB = [sh("05:12", "2pt", "", 1), sh("05:12", "block", "", 2, pno="b"), sh("05:10", "2pt", "", 1, 1)]
ok("a tap after its own club's missed shot is a putback too (the rebound not written), a block by the other club passed over",
   L.is_putback(PB, 2), PB)
ok("...but not the other club's rebound, not a play 6 s earlier, not after a steal",
   not L.is_putback([sh("05:12", "rebound", "offensive", 2), sh("05:10", "2pt", "", 1, 1)], 1)
   and not L.is_putback([sh("05:16", "rebound", "offensive", 1), sh("05:10", "2pt", "", 1, 1)], 1)
   and not L.is_putback([sh("05:12", "steal", "", 1, pno="s"), sh("05:10", "2pt", "", 1, 1)], 1))
SAME = [dict(sh("02:02", "2pt", "", 1, 0, "ana-4"), actionNumber=7), dict(sh("02:02", "2pt", "", 1, 0, "bia-5"), actionNumber=8)]
DS = [{"idj": "5", "q": 3, "tno": 1, "kind": "2pt", "made": 0, "x": 9.0, "y": 50.0, "clock": "02:02"},
      {"idj": "4", "q": 3, "tno": 1, "kind": "2pt", "made": 0, "x": 30.0, "y": 20.0, "clock": "02:02"}]
got = L.place_shots(SAME, DS, lambda d: {"4": "ana-4", "5": "bia-5"}.get(d["idj"], ""))
ok("two misses of one club in the same second: each has its own player's dot", got[7]["x"] == 30.0 and got[8]["x"] == 9.0, got)
got = L.place_shots(SAME, DS, lambda d: "")
ok("...and in order where the chart's players are not known", got[7]["x"] == 9.0 and got[8]["x"] == 30.0, got)
OT = [dict(sh("02:00", "3pt", "", 2, 1, q=1), periodType="OVERTIME", actionNumber=1)]
ok("an overtime's dots are the chart's fifth quarter", L.place_shots(OT, [{"idj": "", "q": 5, "tno": 2, "kind": "3pt", "made": 1, "x": 70.0,
                                                                         "y": 10.0, "clock": "02:00"}], lambda d: "")[1]["x"] == 70.0)
ok("a report without a chart places nothing", L.shot_chart("<html></html>") == ([], {1: {}, 2: {}}))

print("\n-- fetching")


class Fake(L.LnbBrAdapter):
    def __init__(self, pages):
        super().__init__()
        self.pages, self.asked = pages, []
        L.LnbBrAdapter._schedule_at = {}

    def _get(self, url):
        self.asked.append(url)
        return self.pages.get(url)

    def bundle_from_raw(self, raw, external_id, config):
        class B:
            pass
        b = B()
        b.external_id, b.raw, b.tipoff_at, b.venue = external_id, raw, None, None
        return b


ROOT = tempfile.mkdtemp(prefix="lnbbr_test_")
CFG = {"league_path": "nbb", "code": "NBB", "stage": "regular", "repo_root": ROOT}
SCHED_URL = "https://lnb.com.br/nbb/tabela-de-jogos/"
PO = Fake({SCHED_URL: SCHEDULE})
ok("the play-off source takes the play-off games (a published report makes a game final)",
   [(g.external_id, g.status) for g in PO.discover("x", dict(CFG, stage="playoffs"))] == [("27500", "final")])
before = SCHEDULE.replace(REPORT_URL, "https://lnb.com.br/partidas/nbb-2026-2027-vasco-da-gama-x-fortaleza-18102026-2000/")
F = Fake({SCHED_URL: before})
games = F.discover(SCHED_URL, CFG)
ok("the regular season's games only, scheduled until a report is out", sorted(g.external_id for g in games) == ["27110", "27111"]
   and all(g.status == "scheduled" for g in games), [(g.external_id, g.status) for g in games])
ok("...each with its clubs' codes and crests", games[0].extra["home_code"] in ("MOG", "VAS") and games[0].extra["home_logo"].startswith("https://lnb.com.br/crest/"))
F.asked.clear()
ok("no report yet: the fetch returns nothing, and the schedule read a moment ago is not asked for again",
   F.fetch("27111", CFG) is None and F.asked == [], F.asked)
at, seen_rows = L.LnbBrAdapter._schedule_at["nbb"]
L.LnbBrAdapter._schedule_at["nbb"] = (at - L.SCHEDULE_TTL_S - 1, seen_rows)          # half an hour on
F.pages = {SCHED_URL: SCHEDULE, REPORT_URL: REPORT}
b = F.fetch("27111", CFG)
ok("half an hour on, the schedule is read again, gives the report's address, and the report is read",
   b is not None and F.asked == [SCHED_URL, REPORT_URL] and b.raw["tm"]["1"]["code"] == "VAS", F.asked)
ok("...the game keeps its kick-off and hall", b.tipoff_at == "2026-10-18T23:00:00Z" and b.venue == "Ginásio de São Januário", (b.tipoff_at, b.venue))
cache = json.load(open(os.path.join(ROOT, "data", "feed", "NBB", "games.json"), encoding="utf-8"))
ok("...and the address is remembered", cache["27111"]["url"] == REPORT_URL)

print("\n-- sentences seen in the 2025-26 and 2026 seasons")
T = L.translate
ok("a missed dunk attempt is a missed two, subType dunk", T("Rich erra tentativa de enterrada.") == ("2pt", "dunk", 0, "Rich"))
ok("a lost ball and a 5 s or 8 s violation with nobody named are the club's turnovers",
   T("perde posse de bola.") == ("turnover", "ballhandling", 0, "") and T("comete violação de 5s com a posse de bola.") == ("turnover", "5sec", 0, "")
   and T("comete violação de 8s sem passar do meio da quadra.") == ("turnover", "8sec", 0, ""))
ok("...and one with a player named is his", T("L. Muller comete violação de saída de quadra.") == ("turnover", "outofbounds", 0, "L. Muller")
   and T("Gohlke perde posse de bola.") == ("turnover", "ballhandling", 0, "Gohlke"))
ok("a coach's technical is the club's, not a player called 'Técnico do Fluminense'",
   T("Técnico do Fluminense comete falta técnica.") == ("foul", "coachtechnical", 0, "Fluminense")
   and ("foul", "coachtechnical") in L._CLUB_ACTS and T("Munford comete falta técnica.") == ("foul", "technical", 0, "Munford"))
ok("a club named as itself ('Brusque Basquete LO', 'IVV/CETAF') is told from a player", L.is_club("Brusque Basquete LO", L.club_words("Brusque Basquete"))
   and L.is_club("IVV/CETAF", L.club_words("IVV/CETAF")) and not L.is_club("Big", L.club_words("Brusque Basquete")))

print("\n-- the play-by-play's names against the box score's (Liga Ouro 2026, IVV/CETAF)")
Z = dict.fromkeys(L._LINE, 0)
LINES = {1: {"juan-13": dict(Z, min=25.3, p2m=1, p2a=3, p3m=1, p3a=4, ftm=2, fta=4, oreb=2, dreb=6, ast=5, stl=3, blk=1, pf=4, fo=3, tov=1),
             "thiago-22": dict(Z, min=12.4, p2m=2, p2a=2, oreb=3, dreb=2, pf=4, tov=1),
             "vinicius-3": dict(Z, min=31.9, p2m=4, p2a=11),
             "lorenzo-17": dict(Z, min=1.0), "j-guilherme-8": dict(Z, min=1.7), "welton-4": dict(Z, min=0.0)}}


def acts_of(name, line, q=2, secs=300):
    out = []
    for k, n in line.items():
        at = {"p2a": ("2pt", "", 0), "p3a": ("3pt", "", 0), "fta": ("freethrow", "", 0), "oreb": ("rebound", "offensive", 0),
              "dreb": ("rebound", "defensive", 0), "ast": ("assist", "", 0), "stl": ("steal", "", 0), "blk": ("block", "", 0),
              "pf": ("foul", "personal", 0), "fo": ("foulon", "", 0), "tov": ("turnover", "ballhandling", 0)}.get(k)
        if at:
            made = line.get(k[:2] + "m", 0) if k in ("p2a", "p3a", "fta") else 0
            out += [(1, q, secs, (at[0], at[1], 1 if i < made else 0, name)) for i in range(n)]
    return out


ACTS = (acts_of("Gama", {k: v for k, v in LINES[1]["juan-13"].items() if k != "min"})
        + acts_of("Sbardelotti", {k: v for k, v in LINES[1]["thiago-22"].items() if k != "min"})
        + [(1, 2, 479, ("substitution", "in", 0, "Sbardelotti")), (1, 2, 28, ("substitution", "out", 0, "Sbardelotti"))]
        + acts_of("Vinícius", {"p2a": 11, "p2m": 4})
        + [(1, 4, 99, ("substitution", "in", 0, "Klein"))]
        + [(1, 3, 200, ("rebound", "offensive", 0, "IVV/CETAF")), (1, 3, 100, ("turnover", "ballhandling", 0, "IVV/CETAF"))])
WHO = {(1, "vinícius"): "vinicius-3"}
got = L.reconcile(ACTS, LINES, lambda t, a: WHO.get((t, a.casefold()), ""), {1: L.club_words("IVV/CETAF")})
ok("each renamed player is the one box line his plays add up to, exactly ('Gama' = Juan, 'Sbardelotti' = Thiago)",
   got.get((1, "gama")) == "juan-13" and got.get((1, "sbardelotti")) == "thiago-22", got)
ok("a quiet one (no stats: 'Entra Klein' at 1:39 of the fourth) is the quiet line whose minutes are his time on court (1:42, not 1:00)",
   got.get((1, "klein")) == "j-guilherme-8", got)
ok("...never a line with no minutes, never a name the box score has, never the club", "welton-4" not in got.values()
   and (1, "vinícius") not in got and (1, "ivv/cetaf") not in got, got)
TWIN = {1: {"x-1": dict(Z, min=1.0), "y-2": dict(Z, min=1.0)}}
got = L.reconcile([(1, 4, 60, ("substitution", "in", 0, "Fulano")), (1, 4, 60, ("substitution", "in", 0, "Beltrano"))], TWIN, lambda t, a: "")
ok("two names that fit two lines equally are left alone (not guessed)", got == {}, got)
ok("time on court from a name's own substitutions, quarter by quarter", L.on_court([(2, 479, "in"), (2, 28, "out")]) == 451
   and L.on_court([(4, 99, "in")]) == 99 and L.on_court([(3, 400, "out")]) == 200)

print("\n-- a change put right at one clock (Liga Ouro 2026, game 26873, third quarter)")


def e_(gt, at, sub, pno, t=1):
    return {"period": 3, "periodType": "REGULAR", "gt": gt, "tno": t, "pno": pno, "actionType": at, "subType": sub}


Q3 = [dict(e_("10:00", "period", "start", ""), tno=0), e_("09:26", "turnover", "ballhandling", "emerson"),
      e_("09:26", "substitution", "out", "l-muller"), e_("09:26", "substitution", "in", "emerson"),
      e_("09:26", "substitution", "out", "emerson"), e_("09:26", "substitution", "in", "l-muller"),
      e_("09:10", "substitution", "out", "vitor"), e_("09:10", "substitution", "in", "emerson"), e_("08:22", "turnover", "ballhandling", "foresti"),
      e_("08:18", "substitution", "out", "l-muller"), e_("08:18", "substitution", "in", "scherrer"), e_("07:50", "rebound", "defensive", "ryan"),
      e_("06:41", "2pt", "", "pedrosa")]
MIN = {p: 20.0 for p in ("emerson", "l-muller", "vitor", "foresti", "scherrer", "ryan", "pedrosa", "allen")}
five = L.opening_five(Q3, 1, {"emerson", "pedrosa", "ryan", "scherrer", "vitor"}, MIN)
ok("the quarter's opening five is the one its plays bear out (Emerson loses the ball before the lines; Muller was not on)",
   five == {"emerson", "pedrosa", "ryan", "vitor", "foresti"}, five)

print("\n-- a change written in two halves at one clock (NBB 2025-26, game 26897)")


def g_(gt, at, sub, pno, t=2):
    return {"period": 1, "periodType": "REGULAR", "gt": gt, "tno": t, "pno": pno, "actionType": at, "subType": sub}


EVS = [g_("03:58", "substitution", "out", "baralle"), g_("03:58", "foul", "personal", "johnson"), g_("03:58", "block", "", "doria"),
       g_("03:58", "substitution", "in", "negrete"), g_("03:54", "3pt", "", "scott", t=1)]
ST = {1: ["a", "b", "c", "d", "scott"], 2: ["baralle", "johnson", "doria", "cummings", "gui"]}
got = [(e["actionType"], e["pno"]) for e in L.close_gaps(EVS, ST)]
ok("the second half is moved up beside the first, so the club is never four on court",
   got == [("substitution", "baralle"), ("substitution", "negrete"), ("foul", "johnson"), ("block", "doria"), ("3pt", "scott")], got)
FT = [g_("00:14", "substitution", "out", "baralle"), g_("00:14", "substitution", "in", "negrete"), g_("00:14", "freethrow", "1of2", "scott", t=1),
      g_("00:14", "substitution", "out", "negrete"), g_("00:14", "substitution", "in", "baralle")]
ok("...a change before the free throws and one after them stay where they are", L.close_gaps(FT, ST) == FT)

print("\n-- a report with no stats (an article only: Liga Ouro 2026 game 26825, some NBB play-off games)")
L.LnbBrAdapter._schedule_at = {}
ARTICLE = "<html><title>Liga Ouro 2026 | Fluminense 76 x 52 Instituto Viva Vida/Cetaf</title><p>Com atuação segura...</p></html>"
N = Fake({SCHED_URL: SCHEDULE, REPORT_URL: ARTICLE})
NROOT = tempfile.mkdtemp(prefix="lnbbr_nobox_")
NCFG = dict(CFG, repo_root=NROOT)
N.discover(SCHED_URL, NCFG)
N.asked.clear()
ok("it gives no game", N.fetch("27111", NCFG) is None and N.asked == [REPORT_URL], N.asked)
N.asked.clear()
N.discover(SCHED_URL, NCFG)
N.asked.clear()
ok("...and is not read again for 12 hours (the schedule's next pass keeps the note)", N.fetch("27111", NCFG) is None and N.asked == [], N.asked)
nc = json.load(open(os.path.join(NROOT, "data", "feed", "NBB", "games.json"), encoding="utf-8"))
nc["27111"]["nobox"] -= L.NOBOX_RECHECK_S + 1
json.dump(nc, open(os.path.join(NROOT, "data", "feed", "NBB", "games.json"), "w", encoding="utf-8"))
N.pages[REPORT_URL] = REPORT
b = N.fetch("27111", NCFG)
ok("...then it is, and once the stats are there the game is read", b is not None and N.asked == [REPORT_URL]
   and "nobox" not in json.load(open(os.path.join(NROOT, "data", "feed", "NBB", "games.json"), encoding="utf-8"))["27111"], N.asked)

print("\n-- a runner the site refuses (GitHub's: 403)")


class Resp:
    def __init__(self, code):
        self.status_code, self.text, self.encoding = code, "", "utf-8"


asked = []
_real_get = L.requests.get
L.requests.get = lambda url, **kw: (asked.append(url), Resp(403))[1]
L.LnbBrAdapter._last_req = 0.0
_gap = L.GAP_S
L.GAP_S = 0
try:
    L.LnbBrAdapter._schedule_at, L.LnbBrAdapter._refused = {}, False
    R = L.LnbBrAdapter()
    RCFG = dict(CFG, repo_root=tempfile.mkdtemp(prefix="lnbbr_refused_"))
    first = R.discover(SCHED_URL, RCFG)
    again = [R.fetch("27111", RCFG) for _ in range(5)]
finally:
    L.requests.get, L.GAP_S = _real_get, _gap
    L.LnbBrAdapter._refused = False
ok("the schedule is asked for once, answered 403: no fixture, no game, and not one request more (a live lane's polls)",
   first == [] and again == [None] * 5 and len(asked) == 1, asked)

print("\n-- the config")
src = [s for s in json.load(open(os.path.join(HERE, "..", "..", "config", "ingest-sources.json"), encoding="utf-8"))["sources"] if s["adapter"] == "lnbbr"]
ok("NBB and Liga Ouro, a regular season and a play-off source each; no LDB (it publishes no box scores)",
   sorted((s["league_slug"], s["adapter_config"]["stage"]) for s in src) == [("liga-ouro", "playoffs"), ("liga-ouro", "regular"), ("nbb", "playoffs"), ("nbb", "regular")],
   [(s["league_slug"], s["adapter_config"]["stage"]) for s in src])
ok("the adapter is registered", __import__("adapters").get_adapter("lnbbr").name == "lnbbr")

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
