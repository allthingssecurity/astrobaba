export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

// This is a compressed context of the provided OCR text for the AI to reference.
// In a real production app, this would be indexed in a vector database.
export const PARASARA_CONTEXT = `
BOOK CONTEXT: BRIHAT PARASARA HORA SASTRA (Vol 1)
Key Teachings for Analysis:

1. PLANETARY CHARACTERS:
- Sun: Soul, square body, blood-red eyes, bilious.
- Moon: Mind, round body, windy/phlegmatic.
- Mars: Strength, cruel, blood-red eyes, bilious.
- Mercury: Speech, mixed humors, attractive.
- Jupiter: Knowledge, big body, phlegmatic.
- Venus: Potency, charming, phlegmatic/windy.
- Saturn: Grief, emaciated, windy, dark.
- Rahu/Ketu: Smoky, windy, outcaste.

2. HOUSE EFFECTS (Bhavas):
- 1st: Physique, appearance, vigor.
- 2nd: Wealth, family, speech, eyes.
- 3rd: Courage, co-borns (younger), throat.
- 4th: Mother, vehicles, happiness, lands.
- 5th: Progeny, intelligence, mantra, romance.
- 6th: Enemies, diseases, debts.
- 7th: Spouse, partnership, travel.
- 8th: Longevity, death, hidden aspects.
- 9th: Fortune, father, religion, guru.
- 10th: Karma, profession, honor, authority.
- 11th: Gains, elder siblings.
- 12th: Expenses, loss, liberation, foreign lands.

3. SPECIAL YOGAS:
- Gaja Kesari: Jupiter in angle from Moon/Ascendant.
- Rajayogas: Lords of Kendra (Angles) and Trikona (Trines) related.
- Pancha Mahapurusha Yogas: Mars, Mercury, Jupiter, Venus, Saturn in own/exaltation in angles.
- Adhi Yoga: Benefics in 6, 7, 8 from Moon/Lagna.
- Vipareeta Raja Yoga: Lords of 6, 8, 12 in 6, 8, 12.
- Kemadruma: No planet on either side of Moon (cancellations apply).

4. SHADBALA (Six-fold Strength):
- Sthaana (Positional), Dig (Directional), Kala (Temporal), Cheshta (Motional), Naisargika (Natural), Drik (Aspectual).
- Requirement: Sun 6.5 Rupas, Moon 6.0, Mars 5.0, Mercury 7.0, Jupiter 6.5, Venus 5.5, Saturn 5.0.

5. VARGAS (Divisional Charts):
- D1 (Rasi): Body, General destiny.
- D9 (Navamsa): Spouse, Inner strength, Fruit of tree.
- D10 (Dasamsa): Career, Profession.
- D7 (Saptamsa): Progeny.

6. DASA SYSTEM:
- Vimshottari Dasa is primary. Analyze current Dasa lord's position, lordship, and strength.

7. AV ASTHAS (States):
- Baladi (Infant, Youth, etc.) based on degrees.
- Sayanadi (Sleeping, Eating, etc.) - complex calculation affecting results.
  - Lajjita, Garvita, Kshudita, etc. affects bhava results.

INSTRUCTION: Use these principles to analyze the provided birth chart data.
`;
