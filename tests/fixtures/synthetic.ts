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
