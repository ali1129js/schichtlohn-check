// Synthetic payslips as pdf.js text items (made-up person "Max Beispiel", made-up companies,
// made-up numbers). They mimic the LAYOUT of real payroll programs only.
type Item = { str: string; transform: number[]; width: number };
const CH = 5; // width of one character at size 10

class Page {
  items: Item[] = [];
  y = 800;
  t(str: string, x: number, y = this.y) {
    this.items.push({ str, transform: [10, 0, 0, 10, x, y], width: CH * str.length });
    return this;
  }
  r(str: string, xr: number, y = this.y) {
    return this.t(str, xr - CH * str.length, y);
  }
  down(dy = 14) {
    this.y -= dy;
    return this;
  }
}

/** zvoove Payroll style: Lohnartbezeichnung | Tage | Menge | Satz | Zu/Ab | St SV | Betrag. */
export function zvooveItems(): Item[] {
  const p = new Page();
  p.t("Beispiel Zeitarbeit GmbH", 40).r("Abrechnung der Brutto/Netto-Bezüge", 550);
  p.down().t("Beispielweg 1, 00000 Musterort", 40);
  p.down(20).t("Abrechnungszeitraum 01.10.-31.10.2026", 40).t("Oktober 2026", 400);
  p.down().t("Max Beispiel", 40).t("Pers.-Nr. 0000", 400);
  p.down(24);
  p.t("LA", 40).t("Lohnartbezeichnung", 70).r("Tage", 300).r("Menge", 350).r("Satz", 400).r("Zu/Ab", 450).t("St", 462).t("SV", 478).r("Betrag", 550);
  const rows: [string, string, string, string, string, string, string, string, string][] = [
    ["1000", "Normalstunden", "", "150,00", "16,08", "", "L", "L", "2.412,00"],
    ["1100", "Branchenzuschlag", "", "158,00", "2,41", "", "L", "L", "380,78"],
    ["1300", "Nachtzuschlag 25%", "", "40,00", "18,49", "4,62", "F", "F", "184,90"],
    ["1310", "Sonntagszuschlag 50%", "", "8,00", "18,49", "9,25", "F", "F", "73,96"],
    ["1400", "Urlaubsentgelt", "", "", "", "", "L", "L", "307,20"],
    ["1500", "Freizeitauszahlung", "", "8,00", "16,08", "", "L", "L", "128,64"],
    ["1600", "Fahrgeld", "18", "", "2,50", "", "F", "F", "45,00"],
    ["1700", "Gleitzeit +", "", "6,50", "", "", "", "", "0,00"],
    ["1800", "Musterprojekt Ausgleich", "", "", "", "", "L", "L", "50,00"],
  ];
  for (const [la, bez, tage, menge, satz, zuab, st, sv, betrag] of rows) {
    p.down().t(la, 40).t(bez, 70);
    if (tage) p.r(tage, 300);
    if (menge) p.r(menge, 350);
    if (satz) p.r(satz, 400);
    if (zuab) p.r(zuab, 450);
    if (st) p.t(st, 462);
    if (sv) p.t(sv, 478);
    p.r(betrag, 550);
  }
  // label/value block
  p.down(24).t("Gesamtbrutto", 40).t("Steuerbrutto", 150).t("KVverspfl.", 260).t("Netto", 370).t("Auszahlung", 460);
  p.down().r("3.582,48", 100).r("3.278,62", 210).r("3.278,62", 320).r("2.301,15", 420).r("2.301,15", 520);
  p.down(20).t("AZK Saldo", 40).r("24,50", 200);
  // year-to-date: heading carries the first pair
  p.down(24).t("Jahressummen", 40).t("Gesamtbrutto", 150).r("31.234,56", 300).t("Auszahlung", 330).r("2.301,15", 550);
  p.down().t("Steuerbrutto", 150).r("28.000,00", 300);
  p.down().t("Nachtzuschlag", 150).r("1.660,00", 300);
  p.down(30).t("Programmversion zvoove Payroll 9.9 (Beispiel)", 40);
  return p.items;
}

/** DATEV LODAS style: Lohnart | Bezeichnung | Menge | Faktor | Betrag. */
export function datevItems(): Item[] {
  const p = new Page();
  p.t("Muster Personal GmbH", 40).r("DATEV LODAS", 550);
  p.down(20).t("Abrechnung der Brutto/Netto-Bezüge für September 2026", 40);
  p.down().t("Max Beispiel", 40);
  p.down(24).t("Lohnart", 40).t("Bezeichnung", 90).r("Menge", 380).r("Faktor", 450).r("Betrag", 550);
  const rows: [string, string, string, string, string][] = [
    ["2000", "Std.Lohn", "160,00", "16,08", "2.572,80"],
    ["2300", "Nachtzuschlag 25%", "20,00", "4,02", "80,40"],
    ["2900", "Werkzeuggeld", "", "", "12,00"],
  ];
  for (const [la, bez, menge, faktor, betrag] of rows) {
    p.down().t(la, 40).t(bez, 90);
    if (menge) p.r(menge, 380);
    if (faktor) p.r(faktor, 450);
    p.r(betrag, 550);
  }
  p.down(24).t("Gesamt-Brutto", 40).r("2.665,20", 550);
  p.down().t("Steuer-Brutto", 40).r("2.584,80", 550);
  return p.items;
}

/**
 * "Lohn- und Gehaltsabrechnung MM.YYYY" style (layout B), monthly SALARY: two-line column
 * headers, a Jahressummen (year-to-date) column on every row, totals with the year value on the
 * same line, deductions in the Zuschlagssatz column, a WERTE block in Monat | Jahr columns.
 * Made-up company, person and numbers.
 */
export function salaryMmYyyyItems(): Item[] {
  const p = new Page();
  p.t("Beispiel Handwerk GmbH", 40).r("Lohn- und Gehaltsabrechnung 09.2026", 590);
  p.down().t("Musterstraße 2, 00000 Beispielstadt", 40);
  p.down(20).t("Max Beispiel", 40).t("Pers.-Nr. 0001", 400);
  p.down(24);
  p.t("Kosten-", 40).t("Kosten-", 80).t("Lohn-", 120).t("Bezeichnung", 160).t("Stunden/", 300).t("Lohnsatz", 350).t("Zuschlags-", 400).r("Betrag", 500).t("GB/ST/SV", 505).r("Jahres-", 590);
  p.down(10).t("stelle", 40).t("träger", 80).t("art", 120).t("Einheit", 300).t("satz", 400).r("summen", 590);
  p.down().t("100", 40).t("1000", 120).t("Gehalt", 160).r("3.200,00", 500).t("J", 510).t("J", 525).t("J", 540).r("28.800,00", 590);
  p.down().t("100", 40).t("2100", 120).t("Fahrtkostenzuschuss", 160).r("40,00", 500).t("J", 510).t("J", 525).t("J", 540).r("360,00", 590);
  p.down(16).t("GESAMTBRUTTO:", 160).r("3.240,00", 500).r("29.160,00", 590);
  p.down(16).t("Lohnsteuer", 160).r("380,00", 445).r("3.420,00", 590);
  p.down().t("Krankenversicherung", 160).r("280,00", 445).r("2.520,00", 590);
  p.down().t("Rentenversicherung", 160).r("297,60", 445).r("2.678,40", 590);
  p.down().t("Arbeitslosenversicherung", 160).r("41,60", 445).r("374,40", 590);
  p.down().t("Pflegeversicherung", 160).r("54,40", 445).r("489,60", 590);
  p.down().t("Summe gesetzlicher Abzüge", 160).r("1.053,60-", 500);
  p.down(16).t("NETTOVERDIENST:", 160).r("2.186,40", 500).r("19.677,60", 590);
  p.down().t("AN-Ant. Winterbeschäftigungs-Umlage", 160).r("2,40", 445);
  p.down().t("Summe sonst. Abzüge/Zuzahlungen", 160).r("2,40-", 500);
  p.down().t("ZAHLBETRAG:", 160).r("2.184,00", 500);
  p.down(24).t("WERTE", 40).r("Monat", 400).r("Jahr", 500);
  p.down().t("Steuerbrutto", 40).r("3.240,00", 400).r("29.160,00", 500);
  p.down().t("SV-Brutto", 40).r("3.240,00", 400).r("29.160,00", 500);
  p.down(30).t("Betrag dankend erhalten", 40).t("Version 5.0 (Beispiel)", 400);
  return p.items;
}

/**
 * "Abrechnung der Brutto-Netto-Bezüge" style with the footer "Lohn+Gehalt pro" (layout C),
 * hourly: amounts with " EUR", a paid holiday at 100 % plus a real holiday surcharge, a Σ row,
 * the Steuer / SV grid with the values below the labels, totals in a right column with the value
 * below, the "Aufgelaufene Jahreswerte" (year-to-date) block on the left of the same lines.
 * Made-up company, person and numbers.
 */
export function lohnGehaltProItems(): Item[] {
  const p = new Page();
  p.t("Beispiel Technik GmbH", 40).t("Abrechnung der Brutto-Netto-Bezüge", 250).t("September 2026", 480);
  p.down(20).t("Max Beispiel", 40).t("Pers.-Nr. 0002", 250);
  p.down().t("Urlaub Vorjahr", 250).r("2,00", 360).t("Urlaubsanspruch", 380).r("30,00", 480).t("Resturlaub", 500).r("12,00", 580);
  p.down(24);
  p.t("Lohnart", 40).t("Bezeichnung", 80).r("Menge", 300).r("Faktor", 350).r("%-Zuschlag", 405).t("St*", 412).t("SV*", 430).t("GB*", 448).r("Betrag", 560);
  const rows: [string, string, string, string, string, string, string, string, string][] = [
    ["1000", "Lohn", "160,00", "15,00", "", "L", "L", "J", "2.400,00 EUR"],
    ["1200", "Feiertagsstunden 100 %", "8,00", "15,00", "100,00", "L", "L", "J", "120,00 EUR"],
    ["1210", "Feiertagszuschlag", "4,00", "15,00", "100,00", "F", "F", "J", "60,00 EUR"],
    ["5300", "Inflationsausgleich", "", "", "", "F", "F", "J", "110,00 EUR"],
    ["1500", "Erfüllungs-Boni (Produktion)", "", "", "", "L", "L", "J", "140,00 EUR"],
  ];
  for (const [la, bez, menge, faktor, zu, st, sv, gb, betrag] of rows) {
    p.down().t(la, 40).t(bez, 80);
    if (menge) p.r(menge, 300);
    if (faktor) p.r(faktor, 350);
    if (zu) p.r(zu, 405);
    p.t(st, 414).t(sv, 432).t(gb, 450);
    p.r(betrag, 560);
  }
  p.down().t("Σ", 40).r("2.830,00 EUR", 560);
  p.down(24).t("Steuer-Brutto", 40).t("Lohnsteuer", 120).t("Kirchensteuer", 180).t("SolZ", 260).t("KV-Brutto", 320).t("Steuerrechtl. Abzüge", 470);
  p.down().r("2.720,00 EUR", 100).r("310,00 EUR", 170).r("0,00 EUR", 250).r("0,00 EUR", 310).r("2.830,00 EUR", 390).r("310,00 EUR", 560);
  p.down(16).t("RV-Brutto", 40).t("AV-Brutto", 100).t("KV-Beitrag", 160).t("PV-Beitrag", 220).t("RV-Beitrag", 280).t("AV-Beitrag", 340).t("SV-rechtl. Abzüge", 470);
  p.down().r("2.830,00 EUR", 90).r("2.830,00 EUR", 150).r("238,88 EUR", 210).r("49,14 EUR", 270).r("253,89 EUR", 330).r("35,49 EUR", 390).r("577,40 EUR", 560);
  p.down(16).t("X", 40).t("Gesamtsumme", 50).r("887,40 EUR", 390);
  p.down().t("Nettoentgelt", 470);
  p.down().t("Aufgelaufene Jahreswerte", 40).r("1.942,60 EUR", 560);
  p.down().t("Gesamtbrutto", 40).t("Steuer-Brutto", 150).t("Auszahlungsbetrag", 470);
  p.down().r("25.470,00 EUR", 120).r("24.570,00 EUR", 230).r("1.942,60 EUR", 560);
  p.down().t("Lohnsteuer", 40).t("SV-rechtl. Abzüge", 150);
  p.down().r("2.790,00 EUR", 120).r("5.196,60 EUR", 230);
  p.down(30).t("Lohn+Gehalt pro", 40).t("Seite 1/1", 500);
  return p.items;
}
