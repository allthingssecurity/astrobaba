from __future__ import annotations

from fastapi import APIRouter, HTTPException
from ..schemas import AnalyzeRequest, AnalyzeResponse


router = APIRouter(tags=["analyze"])


# Basic mappings for readability and lords
RASI_EN = {
    "Mesha": "Aries", "Vrishabha": "Taurus", "Vrishabh": "Taurus", "Mithuna": "Gemini",
    "Karka": "Cancer", "Karkaṭa": "Cancer", "Simha": "Leo", "Kanya": "Virgo",
    "Tula": "Libra", "Vrischika": "Scorpio", "Vrichika": "Scorpio", "Dhanu": "Sagittarius",
    "Makara": "Capricorn", "Kumbha": "Aquarius", "Meena": "Pisces",
}
RASI_LORD = {
    "Mesha": "Mars", "Vrishabha": "Venus", "Mithuna": "Mercury", "Karka": "Moon",
    "Simha": "Sun", "Kanya": "Mercury", "Tula": "Venus", "Vrischika": "Mars",
    "Dhanu": "Jupiter", "Makara": "Saturn", "Kumbha": "Saturn", "Meena": "Jupiter",
    # Accept alternates
    "Vrishabh": "Venus", "Vrichika": "Mars", "Karkaṭa": "Moon",
}


def _safe_get(d, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def _current_period(periods, birth_dt=None, now=None):
    from datetime import datetime, timezone as dt_tz
    now = now or datetime.now(dt_tz.utc)
    if not isinstance(periods, list):
        return None
    # prefer periods that end after birth (ignore pre-birth entries)
    filtered = []
    for p in periods:
        try:
            s = datetime.fromisoformat(p.get("start"))
            e = datetime.fromisoformat(p.get("end"))
            # normalize to UTC for reliable comparison
            if s.tzinfo is None:
                s = s.replace(tzinfo=dt_tz.utc)
            else:
                s = s.astimezone(dt_tz.utc)
            if e.tzinfo is None:
                e = e.replace(tzinfo=dt_tz.utc)
            else:
                e = e.astimezone(dt_tz.utc)
            bd_ok = True
            if birth_dt is not None:
                bd = birth_dt
                if bd.tzinfo is None:
                    bd = bd.replace(tzinfo=dt_tz.utc)
                else:
                    bd = bd.astimezone(dt_tz.utc)
                bd_ok = e >= bd
            if bd_ok:
                filtered.append((s, e, p))
        except Exception:
            continue
    for s, e, p in filtered:
        if s <= now <= e:
            return p
    # fallback: first after birth
    filtered.sort(key=lambda x: x[0])
    return filtered[0][2] if filtered else (periods[0] if periods else None)


def _extract_facts(comp: dict) -> dict:
    facts = {}
    kundli = comp.get("kundli", {}).get("data", {})
    facts["moon_sign"] = _safe_get(kundli, "nakshatra_details", "chandra_rasi", "name")
    facts["moon_nakshatra"] = _safe_get(kundli, "nakshatra_details", "nakshatra", "name")
    facts["place"] = _safe_get(comp, "meta", "birth", "location")
    d = _safe_get(comp, 'meta', 'birth', 'date', default='') or ''
    t = _safe_get(comp, 'meta', 'birth', 'time', default='') or ''
    tz = _safe_get(comp, 'meta', 'birth', 'timezone', default='') or ''
    facts["datetime"] = (f"{d} {t} {tz}" if tz else f"{d} {t}").strip()
    from datetime import datetime
    birth_dt = None
    try:
        if tz:
            birth_dt = datetime.fromisoformat(f"{d}T{t}{tz}")
        else:
            birth_dt = datetime.fromisoformat(f"{d}T{t}")
    except Exception:
        birth_dt = None

    # Ascendant from D1 chart
    d1 = comp.get("divisional", {}).get("lagna", {}).get("data", {})
    asc_sign = None
    asc_deg = None
    for house in d1.get("divisional_positions", []) or []:
        for pos in house.get("planet_positions", []) or []:
            if _safe_get(pos, "planet", "name") == "Ascendant":
                asc_sign = _safe_get(house, "rasi", "name")
                asc_deg = pos.get("sign_degree")
                break
        if asc_sign:
            break
    facts["ascendant"] = asc_sign
    facts["asc_degree"] = asc_deg

    # Dasha
    dasha = kundli.get("vimshottari_dasha") or kundli
    maha = _current_period(dasha.get("dasha_periods"), birth_dt=birth_dt) if isinstance(dasha, dict) else None
    antar = _current_period(maha.get("antardasha"), birth_dt=birth_dt) if isinstance(maha, dict) else None
    facts["mahadasha"] = maha.get("name") if isinstance(maha, dict) else None
    facts["antardasha"] = antar.get("name") if isinstance(antar, dict) else None
    facts["mahadasha_until"] = maha.get("end") if isinstance(maha, dict) else None
    facts["antardasha_until"] = antar.get("end") if isinstance(antar, dict) else None

    # Select notable placements from D1
    placements = {}
    by_house = {}
    house_blocks = d1.get("divisional_positions", []) or []
    for house in house_blocks:
        for pos in house.get("planet_positions", []) or []:
            name = _safe_get(pos, "planet", "name")
            rasi = _safe_get(house, "rasi", "name")
            hnum = _safe_get(house, "house", "number")
            if name and name != "Ascendant":
                placements[name] = {"sign": rasi, "house": hnum}
                by_house.setdefault(hnum, []).append({"planet": name, "sign": rasi})
    facts["placements"] = placements
    facts["by_house"] = by_house
    # House sign + lord mapping
    hs: dict[int, dict] = {}
    for hb in house_blocks:
        hnum = _safe_get(hb, "house", "number")
        rasi = _safe_get(hb, "rasi", "name")
        if hnum and rasi:
            hs[hnum] = {"sign": rasi, "lord": RASI_LORD.get(rasi)}
    facts["houses"] = hs

    # Yogas from kundli (summaries only)
    facts["yoga_summaries"] = _safe_get(kundli, "yoga_details") or []
    return facts


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    comp = payload.compute.model_dump()
    f = _extract_facts(comp)

    def house_name(n: int) -> str:
        names = {
            1: "Tanu (Self)", 2: "Dhana (Wealth)", 3: "Sahaja (Siblings)", 4: "Sukha (Home)",
            5: "Putra (Creativity)", 6: "Ripu (Health)", 7: "Yuvati (Partnership)", 8: "Randhra (Transformation)",
            9: "Dharma (Fortune)", 10: "Karma (Career)", 11: "Labha (Gains)", 12: "Vyaya (Loss/Spiritual)"
        }
        return names.get(n, f"House {n}")

    lines: list[str] = []
    # Title
    lines.append("## BPHS‑Grounded Natal Summary")
    # Birth block
    birth_line = []
    if f.get("datetime"): birth_line.append(f"When: {f['datetime']}")
    if f.get("place"): birth_line.append(f"Where: {f['place']}")
    if birth_line:
        lines.append("- " + " | ".join(birth_line))
    # Core facts
    if f.get("ascendant") or f.get("moon_sign") or f.get("moon_nakshatra"):
        lines.append("\n### Core")
        if f.get("ascendant"):
            asc = f["ascendant"]; deg = f.get("asc_degree")
            lines.append(f"- Lagna: {asc}{f' ({deg:.2f}°)' if isinstance(deg,(int,float)) else ''}")
        lines.append(f"- Moon: {f.get('moon_sign') or '?'}; Nakshatra: {f.get('moon_nakshatra') or '?'}")
    # Dasha
    if f.get("mahadasha"):
        lines.append("\n### Vimshottari")
        md = f['mahadasha']; md_to = f.get('mahadasha_until')
        ad = f.get('antardasha'); ad_to = f.get('antardasha_until')
        def _fmt(d):
            try:
                return d.split('T')[0]
            except Exception:
                return d or ''
        lines.append(f"- Mahadasha: {md}{' → until ' + _fmt(md_to) if md_to else ''}")
        if ad:
            lines.append(f"- Antardasha: {ad}{' → until ' + _fmt(ad_to) if ad_to else ''}")
    # Placements
    pl = f.get("placements", {})
    if pl:
        lines.append("\n### Selected D1 Placements")
        for planet in ("Mars", "Saturn", "Jupiter", "Venus", "Mercury"):
            if planet in pl:
                lines.append(f"- {planet}: {pl[planet]['sign']} (House {pl[planet]['house']})")
    # Yogas: hide list to avoid template noise; keep house facts instead
    # House highlights (sign, lord, occupants) for all 12 houses
    houses = f.get("houses", {})
    by_house = f.get("by_house", {})
    if houses:
        lines.append("\n### House Highlights (D1)")
        for h in range(1, 13):
            info = houses.get(h) or {}
            sign = info.get("sign")
            lord = info.get("lord")
            occ = by_house.get(h) or []
            occ_txt = ", ".join([f"{x['planet']} in {x['sign']}" for x in occ]) or "—"
            disp = f"{house_name(h)}: Sign {sign} ({RASI_EN.get(sign, sign)}), Lord {lord}; Occupants: {occ_txt}"
            lines.append(f"- {disp}")
    # Closing guidance
    lines.append("\n### Guidance")
    if f.get("mahadasha"):
        lines.append("- Tie major actions to current MD/AD windows; avoid over‑interpreting beyond actual placements.")
    if "Mars" in pl:
        lines.append("- Channel Mars intensity into deep work; manage risk and impatience.")
    if "Saturn" in pl:
        lines.append("- Favor long‑horizon plans; keep speech/contracts precise.")

    text = "\n".join(lines)
    # Build layman-friendly narrative using only observed facts
    narrative: list[str] = []
    narrative.append("\n## Your Story (Plain Language)")
    # Core persona
    asc = f.get("ascendant")
    moon = f.get("moon_sign")
    nak = f.get("moon_nakshatra")
    if asc or moon or nak:
        persona_bits = []
        if asc:
            persona_bits.append(f"rising sign {asc}")
        if moon:
            persona_bits.append(f"Moon in {moon}")
        if nak:
            persona_bits.append(f"Nakshatra {nak}")
        narrative.append(f"You come across with {', '.join(persona_bits)} — direct and action‑oriented when focused, more reflective when you pause to plan. This is a practical reading based on your actual placements, not a template.")

    pl = f.get("placements", {})
    by_house = f.get("by_house", {})

    def has(planet:str, house:int|None=None, sign:str|None=None) -> bool:
        if planet not in pl:
            return False
        if house is not None and pl[planet].get('house') != house:
            return False
        if sign is not None and pl[planet].get('sign') != sign:
            return False
        return True

    # Tailored highlights from observed facts
    if has('Mars', house=8):
        narrative.append("- You handle intensity well. Mars in the 8th house points to resilience, research depth, and the ability to work through complex or sensitive matters. Channel this into deep work rather than rushed moves.")
    if has('Saturn', house=2):
        narrative.append("- Finances and speech benefit from patience. Saturn in the 2nd suggests steady, deliberate growth and careful wording in important conversations and documents.")
    # Stellium emphasis (e.g., multiple planets in one house)
    for h, items in by_house.items():
        if len(items) >= 3:
            sign = items[0]['sign']
            narrative.append(f"- A strong focus gathers in House {h} ({house_name(h)}), with multiple planets in {sign}. Expect sustained developments here; lean into learning, good mentors, and ethics when making decisions.")

    # Dasha advice
    md = f.get('mahadasha'); ad = f.get('antardasha')
    if md:
        narrative.append("\n### Timing Focus")
        if ad:
            narrative.append(f"- You are in {md} Mahadasha with {ad} Antardasha. Make key moves that suit this period’s tone; keep plans clear in writing and avoid overstretching.")
        else:
            narrative.append(f"- You are in {md} Mahadasha. Let your main priorities follow this period’s strengths; keep routines calm and measured.")

    detailed = text + "\n\n" + "\n".join(narrative)
    # Build a client-friendly report mode with simple sections
    cf: list[str] = []
    cf.append("\n## Client Report Mode")
    # Work & Money
    cf.append("\n### Work & Money")
    # Use placements to tailor
    if has('Mars', house=8):
        cf.append("- You do well in roles that need courage and depth (turnarounds, due diligence, incident/crisis work). Use intensity for deep wins, not quick clashes.")
    if has('Saturn', house=2):
        cf.append("- Finances: slow and steady. Simple rules + consistent logging. Contracts and invoices in clear language save money.")
    # Stellium emphasis
    for h, items in by_house.items():
        if len(items) >= 3:
            if h == 9:
                cf.append("- Growth path: learning, mentors, writing/publishing, foreign or cross‑border collaborations.")
            elif h == 10:
                cf.append("- Growth path: responsibility and reputation—document wins; build authority piece by piece.")
            elif h == 11:
                cf.append("- Growth path: networks and communities—one strong peer group lifts outcomes.")

    # Relationships & Home
    cf.append("\n### Relationships & Home")
    if by_house.get(7):
        cf.append("- Partnership benefits from explicit agreements and regular check‑ins—small clarity prevents big friction.")
    else:
        cf.append("- Love improves with simple rituals: shared calendar, shared goals, one honest talk per week.")
    if by_house.get(4):
        cf.append("- Home responds to gentle structure—declutter in small batches; make rest easy to reach.")
    else:
        cf.append("- Keep home light and simple; fewer objects, more space for recovery.")

    # Health & Mind
    cf.append("\n### Health & Mind")
    if has('Mars', house=8):
        cf.append("- Body calms the mind: 20‑minute daily movement + 5‑minute breath work stabilizes focus.")
    else:
        cf.append("- Short, repeatable routines beat intense bursts—aim for consistency over perfection.")
    if has('Mercury'):
        cf.append("- Brain hygiene: one list, one calendar, one ‘no’—reduce open loops to think clearly.")

    # Timing Now block
    cf.append("\n### Timing Now")
    if md := f.get('mahadasha'):
        if ad := f.get('antardasha'):
            cf.append(f"- Current period: {md} / {ad}. Aim for moves that suit this combo; prefer clear documents and precise scope.")
        else:
            cf.append(f"- Current period: {md}. Let priorities follow this period’s strengths; minimize distractions.")

    # Next 90 Days – actionable
    cf.append("\n### Next 90 Days")
    cf.append("- Ship one proof of value (article, demo, case study, or certificate). Make it simple and visible.")
    cf.append("- Tighten one money habit (auto‑save %, cancel 2 subscriptions, or clear one small debt).")
    cf.append("- Fix one agreement (clean contract or written scope). Future‑you will thank you.")
    cf.append("- Schedule a weekly 30‑minute ‘systems’ block (money, files, tools, routines). Quiet compounding wins.")

    detailed += "\n\n" + "\n".join(cf)

    # Add House-by-House story (grounded: sign, lord, occupants, timing)
    houses = f.get("houses", {}) or {}
    by_house = f.get("by_house", {}) or {}
    md = f.get('mahadasha'); ad = f.get('antardasha')
    if houses:
        story: list[str] = []
        story.append("\n## House‑by‑House (Story)")
        planet_note = {
            "Sun": "vitality and visibility",
            "Moon": "mood, care and nourishment",
            "Mars": "drive, courage and decisive action",
            "Mercury": "thinking, learning and communication",
            "Jupiter": "guidance, growth and teachers",
            "Venus": "relationships, taste and comforts",
            "Saturn": "duty, structure and patience",
            "Rahu": "amplification, foreign links and unconventional paths",
            "Ketu": "simplification, detachment and insight",
        }
        for h in range(1, 13):
            info = houses.get(h) or {}
            sign = info.get("sign")
            sign_en = RASI_EN.get(sign, sign) if sign else None
            lord = info.get("lord")
            occ = by_house.get(h, [])
            title = f"{h}. {house_name(h)} — {sign or '?'} ({sign_en or '?'}) • Lord: {lord or '?'}"
            story.append(f"\n### {title}")
            if occ:
                # One simple sentence per occupant
                for it in occ:
                    p = it.get('planet')
                    s = it.get('sign')
                    note = planet_note.get(p, "influence present")
                    story.append(f"- Contains {p} in {s}: {note}.")
            else:
                story.append("- No resident planets. Results flow through its lord; watch that planet's periods for developments.")
            # Timing tie-in if MD/AD matches lord or occupant
            active = []
            if md and (md == lord or any(it.get('planet') == md for it in occ)):
                active.append(f"Mahadasha {md}")
            if ad and (ad == lord or any(it.get('planet') == ad for it in occ)):
                active.append(f"Antardasha {ad}")
            if active:
                story.append("- Activated now via " + " & ".join(active) + ".")
            # Simple layman suggestion
            if h == 1:
                story.append("- Practical tip: mind and body routines keep you centered; start small, stay consistent.")
            elif h == 2:
                story.append("- Practical tip: prefer steady budgeting and precise words in key conversations.")
            elif h == 7:
                story.append("- Practical tip: spell out agreements; partnership clarity prevents friction.")
            elif h == 8:
                story.append("- Practical tip: manage risk, insure wisely, and use deep work to your advantage.")
            elif h == 9:
                story.append("- Practical tip: keep a mentor/learning track; align choices with your principles.")
            elif h == 10:
                story.append("- Practical tip: document wins and responsibilities; build reputation through consistency.")

        detailed += "\n\n" + "\n".join(story)

    return AnalyzeResponse(analysis=detailed)
