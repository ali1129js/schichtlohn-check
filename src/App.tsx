import { useEffect, useState } from "react";
import { AppShell, TABS, type Tab } from "@/components/AppShell";
import { todayISO } from "@/lib/format";
import { DataPage } from "@/pages/DataPage";
import { PayPage } from "@/pages/PayPage";
import { PayslipPage } from "@/pages/PayslipPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ShiftsPage } from "@/pages/ShiftsPage";

const fromHash = (): Tab => {
  const h = location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? "shifts") as Tab;
};

export function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => window.scrollTo(0, 0), [tab]);
  return (
    <AppShell tab={tab} onTab={setTab}>
      {tab === "shifts" && <ShiftsPage month={month} onMonth={setMonth} />}
      {tab === "pay" && <PayPage month={month} onMonth={setMonth} />}
      {tab === "payslip" && <PayslipPage month={month} onMonth={setMonth} />}
      {tab === "settings" && <SettingsPage />}
      {tab === "data" && <DataPage month={month} />}
    </AppShell>
  );
}
