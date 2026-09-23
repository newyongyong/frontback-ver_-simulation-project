"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Product = { id: number; code: string; name: string };
type MasterImport = { id: number; file_name: string; imported_at: string; sheet_count: number; row_count: number; product_count: number; plant_count: number; line_count: number; line_product_count: number; bom_item_count: number };
type SalesImport = { id: number; file_name: string; imported_at: string; item_count: number };
type SalesItem = { id: number; customer: string; product_code: string; year: number; month: number; quantity_ton: number };
type SalesComparisonItem = { customer: string; product_code: string; year: number; month: number; base_quantity_ton: number; compare_quantity_ton: number; difference_ton: number; difference_rate: number | null };
type SalesComparison = { base_import: SalesImport; compare_import: SalesImport; item_count: number; base_total_ton: number; compare_total_ton: number; difference_total_ton: number; items: SalesComparisonItem[] };
type InventoryImport = { id: number; kind: string; file_name: string; item_count: number };
type ProductInventory = { id: number; snapshot_date: string; product_code: string; process_name: string; line_name: string; stock_status: string; quantity_ton: number };
type RawInventory = { id: number; snapshot_date: string; plant_name: string; material_code: string; quantity_ton: number };
type RawInbound = { id: number; inbound_date: string; plant_name: string; material_code: string; quantity_ton: number };
type LineSpecification = { code: string; name: string; plant_code: string; plant_name: string; process_code: string; operating_efficiency: number | null };
type QualitySpecification = { semi_product_code: string; quality_pass_rate: number; quality_inspection_days: number; production_yield: number; is_final_before_p: boolean };
type ProductProcessSpecification = { product_code: string; process_codes: string[] };
type BomSpecification = { output_product_code: string; input_material_code: string };
type Requirement = { id: number; product_code: string; sales_demand_ton: number; available_inventory_ton: number; safety_stock_days: number; average_daily_sales_ton: number; safety_stock_target_ton: number; required_production_ton: number };
type ScheduleItem = { id: number; planned_date: string; plant_name: string; line_code: string; line_name: string; product_code: string; planned_quantity_ton: number; available_capacity_ton: number; downtime_hours: number; work_rate: number; yield_rate: number; operation_status: string; changeover_hours: number; is_locked: boolean; adjustment_note: string };
type ScheduleShortage = { id: number; product_code: string; required_quantity_ton: number; scheduled_quantity_ton: number; unallocated_quantity_ton: number };
type ScheduleRunMeta = { id:number; planning_run_id:number; version:number; status:string; planning_mode:string; change_reason:string; confirmed_at:string|null };
type RawMaterialBalance = { id: number; balance_date: string; plant_name: string; material_code: string; opening_quantity_ton: number; inbound_quantity_ton: number; required_quantity_ton: number; ending_quantity_ton: number; shortage_quantity_ton: number };
type CalendarDay = { calendar_date: string; is_working: boolean; note: string };
type ActualComparison = { date: string; plant_name: string; line_name: string; product_code: string; planned_ton: number; actual_ton: number; variance_ton: number };
type ScheduleVersion = { id: number; version: number; created_at: string; status: string; planning_year: number; planning_month: number; planning_end_year: number; planning_end_month: number };
type ScheduleVersionComparison = { base_version: { id: number; version: number; created_at: string }; compare_version: { id: number; version: number; created_at: string }; items: { period: string; plant_name: string; product_code: string; process_code: string; base_quantity_ton: number; compare_quantity_ton: number; difference_ton: number }[] };
type DataStatus = { name: string; latest: { id:number; file_name:string; imported_at:string; item_count:number } | null; history: { id:number; file_name:string; imported_at:string; item_count:number }[] };
type SalesValidation = { valid: boolean; parsed_row_count: number; error_count: number; unknown_product_count: number; duplicate_count: number; missing_period_count: number; errors: { category: string; customer: string; product_code: string; period: string; message: string }[]; fileKey: string };
type ScheduleChangeHistory = { id: number; changed_at: string; changed_by: string; change_reason: string; before_values: { planned_date: string; line_name: string; product_code: string; planned_quantity_ton: number }; after_values: { planned_date: string; line_name: string; product_code: string; planned_quantity_ton: number } };
const API_URL = "http://127.0.0.1:8000";
const KOREAN_PUBLIC_HOLIDAYS: Record<number, string[]> = {
  2026: ["01-01", "02-16", "02-17", "02-18", "03-01", "03-02", "05-05", "05-24", "05-25", "06-03", "06-06", "08-15", "08-17", "09-24", "09-25", "09-26", "10-03", "10-05", "10-09", "12-25"],
  2027: ["01-01", "02-06", "02-07", "02-08", "02-09", "03-01", "05-05", "05-13", "06-06", "08-15", "08-16", "09-14", "09-15", "09-16", "10-03", "10-04", "10-09", "10-11", "12-25", "12-27"],
};
function isSalesNonWorkingDay(day: string) {
  const date = new Date(`${day}T00:00:00`);
  return date.getDay() === 0 || date.getDay() === 6 || (KOREAN_PUBLIC_HOLIDAYS[date.getFullYear()] ?? []).includes(day.slice(5));
}
function processLabel(process: string) {
  return process === "H" ? "소성" : process === "S" ? "S처리" : process === "R" ? "재구형화" : process;
}
function addMonths(year: number, month: number, offset: number) {
  const value = year * 12 + month - 1 + offset;
  return { year: Math.floor(value / 12), month: value % 12 + 1 };
}
function periodValue(year: number, month: number) { return `${year}-${String(month).padStart(2, "0")}`; }
function dateValue(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function yesterdayValue() { const date = new Date(); date.setDate(date.getDate() - 1); return dateValue(date); }
function inventoryProcessKey(process: string) { return process === "H" || process.includes("소성") ? "H" : process === "S" || process.includes("S처리") ? "S" : process === "R" || process.includes("재구") ? "R" : "INBOUND"; }
function formatDashboardNumber(value: number) { const rounded = Math.round(value); return rounded ? rounded.toLocaleString("ko-KR") : "-"; }

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const view = pathname.split("/").slice(1).join("-") || "dashboard";
  const pageName: Record<string, string> = { dashboard: "대시보드", "sales-monthly": "판매계획 - 월별 계획", "sales-daily": "판매계획 - 일별 계획", "production-monthly": "생산계획 - 월별 계획", "production-daily": "생산계획 - 일별 계획", "spec-monthly": "생산계획 - 제원치 월별 계획", "spec-daily": "생산계획 - 제원치 일별 계획", "product-inventory": "제품재고", "raw-inventory": "원료재고", "data-upload": "데이터 업로드", "data-compare": "데이터 비교", actual: "생산실적" };
  const [products, setProducts] = useState<Product[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("서버 상태를 확인하고 있습니다.");
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState<MasterImport | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [salesImport, setSalesImport] = useState<SalesImport | null>(null);
  const [salesItems, setSalesItems] = useState<SalesItem[]>([]);
  const [salesImports, setSalesImports] = useState<SalesImport[]>([]);
  const [baseSalesImportId, setBaseSalesImportId] = useState<number | null>(null);
  const [compareSalesImportId, setCompareSalesImportId] = useState<number | null>(null);
  const [salesComparison, setSalesComparison] = useState<SalesComparison | null>(null);
  const [isSalesImporting, setIsSalesImporting] = useState(false);
  const [isSalesValidating, setIsSalesValidating] = useState(false);
  const [salesValidation, setSalesValidation] = useState<SalesValidation | null>(null);
  const salesFileInputRef = useRef<HTMLInputElement>(null);
  const rawInboundAlertInputRef = useRef<HTMLInputElement>(null);
  const [productInventoryImport, setProductInventoryImport] = useState<InventoryImport | null>(null);
  const [rawInventoryImport, setRawInventoryImport] = useState<InventoryImport | null>(null);
  const [productInventory, setProductInventory] = useState<ProductInventory[]>([]);
  const [rawInventory, setRawInventory] = useState<RawInventory[]>([]);
  const [rawInboundItems, setRawInboundItems] = useState<RawInbound[]>([]);
  const [lineSpecifications, setLineSpecifications] = useState<LineSpecification[]>([]);
  const [qualitySpecifications, setQualitySpecifications] = useState<QualitySpecification[]>([]);
  const [productProcessSpecifications, setProductProcessSpecifications] = useState<ProductProcessSpecification[]>([]);
  const [bomSpecifications, setBomSpecifications] = useState<BomSpecification[]>([]);
  const [rawInboundImport, setRawInboundImport] = useState<InventoryImport | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [planningYear, setPlanningYear] = useState(2026);
  const [planningMonth, setPlanningMonth] = useState(9);
  const [planningEndYear, setPlanningEndYear] = useState(2026);
  const [planningEndMonth, setPlanningEndMonth] = useState(11);
  const [calendarYear, setCalendarYear] = useState(2026);
  const [planningRunId, setPlanningRunId] = useState<number | null>(null);
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);
  const [scheduleShortages, setScheduleShortages] = useState<ScheduleShortage[]>([]);
  const [scheduleRunId, setScheduleRunId] = useState<number | null>(null);
  const [scheduleMeta, setScheduleMeta] = useState<ScheduleRunMeta | null>(null);
  const [scheduleChangeReason, setScheduleChangeReason] = useState("");
  const [draftScheduleCells, setDraftScheduleCells] = useState<Record<string, { product_code: string; downtime_hours: number; work_rate: number; operation_status: string }>>({});
  const [rawMaterialBalances, setRawMaterialBalances] = useState<RawMaterialBalance[]>([]);
  const [actualImport, setActualImport] = useState<{file_name:string;item_count:number}|null>(null);
  const [actualComparison, setActualComparison] = useState<ActualComparison[]>([]);
  const [scheduleVersions, setScheduleVersions] = useState<ScheduleVersion[]>([]);
  const [baseScheduleVersionId, setBaseScheduleVersionId] = useState<number | null>(null);
  const [compareScheduleVersionId, setCompareScheduleVersionId] = useState<number | null>(null);
  const [scheduleVersionComparison, setScheduleVersionComparison] = useState<ScheduleVersionComparison | null>(null);
  const [dataStatuses, setDataStatuses] = useState<DataStatus[]>([]);
  const [selectedImports, setSelectedImports] = useState<Record<string, number>>({});
  const [expandedUploadTables, setExpandedUploadTables] = useState<Record<string, boolean>>({});
  const [dailyPlantFilter, setDailyPlantFilter] = useState("all");
  const [dailyProcessFilter, setDailyProcessFilter] = useState("all");
  const [dailyLineFilter, setDailyLineFilter] = useState("all");
  const [isRangeConfirmed, setIsRangeConfirmed] = useState(false);
  const [isPlanningSelectorOpen, setIsPlanningSelectorOpen] = useState(true);
  const [isRequirementModalOpen, setIsRequirementModalOpen] = useState(false);
  const [isInitialScheduleModalOpen, setIsInitialScheduleModalOpen] = useState(false);
  const [initialScheduleConditions, setInitialScheduleConditions] = useState<Record<string, { operation_status: string; downtime_hours: number }>>({});
  const [dailyStartDate, setDailyStartDate] = useState(yesterdayValue);
  const [isPlanningStarted, setIsPlanningStarted] = useState(false);
  const [scheduleChangeHistory, setScheduleChangeHistory] = useState<ScheduleChangeHistory[]>([]);
  const [isPlanLoadOpen, setIsPlanLoadOpen] = useState(false);
  const [planLoadStatus, setPlanLoadStatus] = useState("확정");
  const [loadableSchedules, setLoadableSchedules] = useState<ScheduleVersion[]>([]);
  const [selectedLoadScheduleId, setSelectedLoadScheduleId] = useState<number | null>(null);
  const [planningMode, setPlanningMode] = useState("판매 목표 우선");

  async function loadProducts() {
    const health = await fetch(`${API_URL}/health`);
    const healthData = await health.json();
    const response = await fetch(`${API_URL}/products`);
    if (!response.ok) throw new Error("제품 목록을 불러올 수 없습니다.");
    setProducts(await response.json());
    setMessage(healthData.message);
  }

  useEffect(() => {
    const isReset = window.localStorage.getItem("production-planning-reset") === "true";
    const savedRange = window.localStorage.getItem("production-planning-range");
    if (savedRange) {
      const range = JSON.parse(savedRange) as { year: number; month: number; endYear?: number; endMonth?: number; confirmed: boolean; dailyStartDate?: string };
      const defaultEnd = addMonths(range.year, range.month, 2);
      const previousDefaultEnd = addMonths(range.year, range.month, 3);
      const wasPreviousFourMonthDefault = range.endYear === previousDefaultEnd.year && range.endMonth === previousDefaultEnd.month;
      setPlanningYear(range.year); setCalendarYear(range.year); setPlanningMonth(range.month); setPlanningEndYear(wasPreviousFourMonthDefault ? defaultEnd.year : range.endYear ?? defaultEnd.year); setPlanningEndMonth(wasPreviousFourMonthDefault ? defaultEnd.month : range.endMonth ?? defaultEnd.month); setDailyStartDate(range.dailyStartDate ?? yesterdayValue()); setIsRangeConfirmed(wasPreviousFourMonthDefault ? false : range.confirmed); setIsPlanningStarted(!isReset && !wasPreviousFourMonthDefault && range.confirmed);
    }
    loadProducts().catch(() => setError("FastAPI 서버를 실행해 주세요. README의 백엔드 실행 방법을 확인하세요."));
    fetch(`${API_URL}/data-status`).then((response) => response.ok ? response.json() : []).then(setDataStatuses).catch(() => undefined);
    loadSalesItems().catch(() => undefined);
    loadSalesImports().catch(() => undefined);
    fetch(`${API_URL}/inventories/product/items`).then((r) => r.ok ? r.json() : []).then(setProductInventory).catch(() => undefined);
    fetch(`${API_URL}/inventories/raw/items`).then((r) => r.ok ? r.json() : []).then(setRawInventory).catch(() => undefined);
    fetch(`${API_URL}/inventories/raw-inbound/items`).then((r) => r.ok ? r.json() : []).then(setRawInboundItems).catch(() => undefined);
    fetch(`${API_URL}/specifications/lines`).then((r) => r.ok ? r.json() : []).then(setLineSpecifications).catch(() => undefined);
    fetch(`${API_URL}/specifications/quality`).then((r) => r.ok ? r.json() : []).then(setQualitySpecifications).catch(() => undefined);
    fetch(`${API_URL}/specifications/product-processes`).then((r) => r.ok ? r.json() : []).then(setProductProcessSpecifications).catch(() => undefined);
    fetch(`${API_URL}/specifications/boms`).then((r) => r.ok ? r.json() : []).then(setBomSpecifications).catch(() => undefined);
    fetch(`${API_URL}/scheduler/runs/versions`).then((r) => r.ok ? r.json() : []).then((rows: ScheduleVersion[]) => { setScheduleVersions(rows); if (rows.length > 1) { setBaseScheduleVersionId(rows[1].id); setCompareScheduleVersionId(rows[0].id); } }).catch(() => undefined);
    fetch(`${API_URL}/scheduler/runs/latest`).then((response) => response.ok ? response.json() : null).then((result) => {
      if (!result) return;
      setPlanningRunId(result.planning_run_id); setScheduleRunId(result.id); setScheduleMeta(result); setScheduleItems(result.items); setScheduleShortages(result.shortages);
      loadScheduleChangeHistory(result.id).catch(() => undefined);
      fetch(`${API_URL}/scheduler/runs/${result.id}/raw-material-validation`, { method: "POST" }).then((r) => r.ok ? r.json() : null).then((validation) => { if (validation) setRawMaterialBalances(validation.balances); }).catch(() => undefined);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (view === "production-daily") {
      setDailyPlantFilter("세종 1공장");
      setDailyProcessFilter("H");
      setDailyLineFilter("all");
    }
  }, [view]);

  useEffect(() => {
    if (view.startsWith("spec-")) {
      setDailyProcessFilter("H");
      setDailyLineFilter("all");
    }
  }, [view]);

  const dailyLines = useMemo(() => lineSpecifications.map((line) => ({ plant: line.plant_name, process: line.process_code, line: line.name, code: line.code })).filter((line) => (!view.startsWith("spec-") || line.process === "H") && (dailyPlantFilter === "all" || line.plant === dailyPlantFilter) && (dailyProcessFilter === "all" || line.process === dailyProcessFilter) && (dailyLineFilter === "all" || line.line === dailyLineFilter)).sort((left, right) => `${left.plant}-${left.line}`.localeCompare(`${right.plant}-${right.line}`, "ko", { numeric: true })), [lineSpecifications, dailyPlantFilter, dailyProcessFilter, dailyLineFilter, view]);
  const dailyDates = useMemo(() => { const end = new Date(planningEndYear, planningEndMonth, 0); const dates: string[] = []; for (const current = new Date(`${dailyStartDate}T00:00:00`); current <= end; current.setDate(current.getDate() + 1)) dates.push(dateValue(current)); return dates; }, [dailyStartDate, planningEndYear, planningEndMonth]);
  const scheduleByDateLine = useMemo(() => new Map(scheduleItems.map((item) => [`${item.planned_date}__${item.plant_name}__${item.line_name}`, item])), [scheduleItems]);
  const qualityInboundByDateLine = useMemo(() => { const rows = new Map<string, { codes: string[]; quantity_ton: number }>(); scheduleItems.forEach((item) => { const process = lineSpecifications.find((line) => line.code === item.line_code)?.process_code ?? "H"; const quality = qualitySpecifications.find((spec) => spec.semi_product_code === `${item.product_code}_${process}`) ?? qualitySpecifications.find((spec) => spec.semi_product_code.startsWith(`${item.product_code}_`)); if (!quality || !quality.is_final_before_p) return; const completed = new Date(`${item.planned_date}T00:00:00`); completed.setDate(completed.getDate() + quality.quality_inspection_days); const date = `${completed.getFullYear()}-${String(completed.getMonth() + 1).padStart(2, "0")}-${String(completed.getDate()).padStart(2, "0")}`; const key = `${date}__${item.plant_name}__${item.line_name}`; const current = rows.get(key) ?? { codes: [], quantity_ton: 0 }; if (!current.codes.includes(quality.semi_product_code)) current.codes.push(quality.semi_product_code); current.quantity_ton += item.planned_quantity_ton * quality.quality_pass_rate; rows.set(key, current); }); return rows; }, [scheduleItems, qualitySpecifications, lineSpecifications]);
  const productionDailyRows = useMemo(() => dailyDates.flatMap((day) => { const yearMonth = day.slice(0, 7); const lastDay = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate(); const total = { day, isTotal: true, values: new Map(dailyLines.map((line) => { const items = scheduleItems.filter((item) => item.planned_date.startsWith(yearMonth) && item.plant_name === line.plant && item.line_name === line.line); let inbound = 0; const codes = new Set<string>(); qualityInboundByDateLine.forEach((value, key) => { if (key.startsWith(`${yearMonth}-`) && key.endsWith(`__${line.plant}__${line.line}`)) { inbound += value.quantity_ton; value.codes.forEach((code) => codes.add(code)); } }); return [`${line.plant}__${line.line}`, { downtime: items.reduce((sum, item) => sum + item.downtime_hours, 0), production: items.reduce((sum, item) => sum + item.planned_quantity_ton, 0), inbound, codes: [...codes] }]; })) }; return Number(day.slice(8, 10)) === lastDay ? [{ day, isTotal: false }, total] : [{ day, isTotal: false }]; }), [dailyDates, dailyLines, scheduleItems, qualityInboundByDateLine]);
  const planPeriods = useMemo(() => { const periods: string[] = []; let year = planningYear, month = planningMonth; while ((year < planningEndYear) || (year === planningEndYear && month <= planningEndMonth)) { periods.push(periodValue(year, month)); ({ year, month } = addMonths(year, month, 1)); } return periods; }, [planningYear, planningMonth, planningEndYear, planningEndMonth]);
  const planningPeriodSet = useMemo(() => new Set(planPeriods), [planPeriods]);
  const planningRangeDates = useMemo(() => { const end = new Date(planningEndYear, planningEndMonth, 0); const dates: string[] = []; for (const current = new Date(planningYear, planningMonth - 1, 1); current <= end; current.setDate(current.getDate() + 1)) dates.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`); return dates; }, [planningYear, planningMonth, planningEndYear, planningEndMonth]);
  const initialScheduleLines = useMemo(() => lineSpecifications.filter((line) => line.process_code === "H"), [lineSpecifications]);
  const salesTableRows = useMemo(() => Object.values(salesItems.reduce<Record<string, { customer: string; product: string; values: Record<string, number> }>>((all, item) => { const key = `${item.customer}__${item.product_code}`; const row = all[key] ?? { customer: item.customer, product: item.product_code, values: {} }; const period = `${item.year}-${String(item.month).padStart(2, "0")}`; row.values[period] = (row.values[period] ?? 0) + item.quantity_ton; all[key] = row; return all; }, {})).filter((row) => planPeriods.some((period) => row.values[period])), [salesItems, planPeriods]);
  const rangeDailyDates = dailyDates;
  const salesDailyRows = useMemo(() => { const products = Object.values(salesItems.reduce<Record<string, { product: string; customer: string }>>((all, item) => { all[item.product_code] ??= { product: item.product_code, customer: item.customer }; return all; }, {})); return rangeDailyDates.flatMap((day) => { const [year, month] = day.slice(0, 7).split("-").map(Number); const days = new Date(year, month, 0).getDate(); const workingDays = Array.from({ length: days }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`).filter((date) => !isSalesNonWorkingDay(date)).length; const daily = { day, isTotal: false, isNonWorking: isSalesNonWorkingDay(day), products: products.map((product) => ({ ...product, daily: isSalesNonWorkingDay(day) ? 0 : salesItems.filter((item) => item.year === year && item.month === month && item.product_code === product.product).reduce((sum, item) => sum + item.quantity_ton, 0) / Math.max(workingDays, 1) })) }; const isMonthEnd = Number(day.slice(8, 10)) === days; const total = { day, isTotal: true, isNonWorking: false, products: products.map((product) => ({ ...product, daily: salesItems.filter((item) => item.year === year && item.month === month && item.product_code === product.product).reduce((sum, item) => sum + item.quantity_ton, 0) })) }; return isMonthEnd ? [daily, total] : [daily]; }); }, [salesItems, rangeDailyDates]);
  const productInventoryGroups = useMemo(() => { const productCodes = [...new Set([...productInventory.map((item) => item.product_code), ...salesItems.map((item) => item.product_code), ...productProcessSpecifications.map((item) => item.product_code)])].sort(); return productCodes.map((code) => ({ code, processes: [...(productProcessSpecifications.find((item) => item.product_code === code)?.process_codes ?? []), "INBOUND"] })); }, [productInventory, salesItems, productProcessSpecifications]);
  const productInventoryOpening = useMemo(() => { const snapshots = new Map<string, { date: string; quantity: number }>(); productInventory.filter((item) => item.snapshot_date <= dailyStartDate).forEach((item) => { const key = `${item.product_code}__${inventoryProcessKey(item.process_name)}`; const current = snapshots.get(key); if (!current || item.snapshot_date > current.date) snapshots.set(key, { date: item.snapshot_date, quantity: item.quantity_ton }); else if (item.snapshot_date === current.date) current.quantity += item.quantity_ton; }); return new Map([...snapshots].map(([key, value]) => [key, value.quantity])); }, [productInventory, dailyStartDate]);
  const productInventoryFlowRows = useMemo(() => {
    const balances = new Map(productInventoryOpening);
    const inboundFor = (day: string, productCode: string) => [...qualityInboundByDateLine.entries()].filter(([key]) => key.startsWith(`${day}__`)).reduce((sum, [, value]) => sum + (value.codes.some((code) => code.replace(/_[^_]+$/, "") === productCode) ? value.quantity_ton : 0), 0);
    return rangeDailyDates.map((day) => ({ day, products: productInventoryGroups.map((group) => ({ code: group.code, processes: group.processes.map((process, index) => {
      const production = process === "INBOUND" ? inboundFor(day, group.code) : scheduleItems.filter((item) => item.planned_date === day && item.product_code === group.code && lineSpecifications.find((line) => line.code === item.line_code)?.process_code === process).reduce((sum, item) => sum + item.planned_quantity_ton, 0);
      const nextProcess = group.processes[index + 1];
      const consumption = process === "INBOUND" ? (salesDailyRows.find((row) => row.day === day && !row.isTotal)?.products.find((item) => item.product === group.code)?.daily ?? 0) : nextProcess && nextProcess !== "INBOUND" ? scheduleItems.filter((item) => item.planned_date === day && item.product_code === group.code && lineSpecifications.find((line) => line.code === item.line_code)?.process_code === nextProcess).reduce((sum, item) => sum + item.planned_quantity_ton, 0) : nextProcess === "INBOUND" ? inboundFor(day, group.code) : 0;
      const key = `${group.code}__${process}`;
      const stock = (balances.get(key) ?? 0) + production - consumption;
      balances.set(key, stock);
      return { process, production, consumption, stock };
    }) })) }));
  }, [rangeDailyDates, productInventoryGroups, productInventoryOpening, qualityInboundByDateLine, scheduleItems, lineSpecifications, salesDailyRows]);
  const productionMonthlyRows = useMemo(() => Object.values(scheduleItems.reduce<Record<string, { plant: string; process: string; line: string; product: string; values: Record<string, number> }>>((all, item) => { const period = item.planned_date.slice(0, 7); const spec = lineSpecifications.find((line) => line.code === item.line_code); const key = `${item.plant_name}__${spec?.process_code ?? "미분류"}__${item.line_name}__${item.product_code}`; const row = all[key] ?? { plant: item.plant_name, process: spec?.process_code ?? "미분류", line: item.line_name, product: item.product_code, values: {} }; row.values[period] = (row.values[period] ?? 0) + item.planned_quantity_ton; all[key] = row; return all; }, {})).filter((row) => planPeriods.some((period) => row.values[period])), [scheduleItems, lineSpecifications, planPeriods]);
  const groupedProductionRows = useMemo(() => { const rows = [...productionMonthlyRows].sort((left, right) => `${left.plant}__${left.process}__${left.line}__${left.product}`.localeCompare(`${right.plant}__${right.process}__${right.line}__${right.product}`, "ko", { numeric: true })); return rows.map((row, index) => ({ ...row, plantSpan: index === 0 || rows[index - 1].plant !== row.plant ? rows.filter((item) => item.plant === row.plant).length : 0, processSpan: index === 0 || rows[index - 1].plant !== row.plant || rows[index - 1].process !== row.process ? rows.filter((item) => item.plant === row.plant && item.process === row.process).length : 0, lineSpan: index === 0 || rows[index - 1].plant !== row.plant || rows[index - 1].process !== row.process || rows[index - 1].line !== row.line ? rows.filter((item) => item.plant === row.plant && item.process === row.process && item.line === row.line).length : 0 })); }, [productionMonthlyRows]);
  const productInboundRows = useMemo(() => { const rows: Record<string, { product: string; values: Record<string, number> }> = {}; qualityInboundByDateLine.forEach((value, key) => { const period = key.slice(0, 7); value.codes.forEach((code) => { const row = rows[code] ?? { product: code, values: {} }; row.values[period] = (row.values[period] ?? 0) + value.quantity_ton / value.codes.length; rows[code] = row; }); }); return Object.values(rows); }, [qualityInboundByDateLine]);
  const selectedRawLineCodes = useMemo(() => new Set(lineSpecifications.filter((line) => (dailyPlantFilter === "all" || line.plant_name === dailyPlantFilter) && (dailyProcessFilter === "all" || line.process_code === dailyProcessFilter) && (dailyLineFilter === "all" || line.name === dailyLineFilter)).map((line) => line.code)), [lineSpecifications, dailyPlantFilter, dailyProcessFilter, dailyLineFilter]);
  const selectedRawMaterialCodes = useMemo(() => { if (dailyProcessFilter === "all" && dailyLineFilter === "all") return null; const selectedProducts = new Set(scheduleItems.filter((item) => selectedRawLineCodes.has(item.line_code)).map((item) => item.product_code)); return new Set(bomSpecifications.filter((bom) => [...selectedProducts].some((product) => bom.output_product_code.startsWith(product))).map((bom) => bom.input_material_code)); }, [dailyProcessFilter, dailyLineFilter, scheduleItems, selectedRawLineCodes, bomSpecifications]);
  const rawMaterials = useMemo(() => [...new Set([...rawInventory, ...rawInboundItems].filter((item) => (dailyPlantFilter === "all" || item.plant_name === dailyPlantFilter) && (!selectedRawMaterialCodes || selectedRawMaterialCodes.has(item.material_code))).map((item) => item.material_code).concat(rawMaterialBalances.filter((item) => (dailyPlantFilter === "all" || item.plant_name === dailyPlantFilter) && (!selectedRawMaterialCodes || selectedRawMaterialCodes.has(item.material_code))).map((item) => item.material_code)))].sort(), [rawInventory, rawInboundItems, rawMaterialBalances, dailyPlantFilter, selectedRawMaterialCodes]);
  const rawStockByDayMaterial = useMemo(() => { const snapshots = new Map<string, { date: string; quantity: number }>(); rawInventory.filter((item) => item.snapshot_date <= dailyStartDate).forEach((item) => { const key = `${item.plant_name}__${item.material_code}`; const current = snapshots.get(key); if (!current || item.snapshot_date > current.date) snapshots.set(key, { date: item.snapshot_date, quantity: item.quantity_ton }); else if (item.snapshot_date === current.date) current.quantity += item.quantity_ton; }); const balances = new Map([...snapshots].map(([key, value]) => [key, value.quantity])); const stockByDay = new Map<string, number>(); dailyDates.forEach((day) => { rawMaterials.forEach((material) => { const plants = [...new Set([...rawInventory, ...rawInboundItems, ...rawMaterialBalances].filter((item) => item.material_code === material && (dailyPlantFilter === "all" || item.plant_name === dailyPlantFilter)).map((item) => item.plant_name))]; const total = plants.reduce((sum, plant) => { const key = `${plant}__${material}`; const inbound = rawInboundItems.filter((item) => item.inbound_date === day && item.plant_name === plant && item.material_code === material).reduce((value, item) => value + item.quantity_ton, 0); const usage = rawMaterialBalances.filter((item) => item.balance_date === day && item.plant_name === plant && item.material_code === material).reduce((value, item) => value + item.required_quantity_ton, 0); const next = (balances.get(key) ?? 0) + inbound - usage; balances.set(key, next); return sum + next; }, 0); stockByDay.set(`${day}__${material}`, total); }); }); return stockByDay; }, [rawInventory, rawInboundItems, rawMaterialBalances, dailyStartDate, dailyDates, rawMaterials, dailyPlantFilter]);
  const rawSupplyRisks = useMemo(() => {
    const shortages = new Map<string, { day: string; quantity: number }>();
    rawStockByDayMaterial.forEach((stock, key) => {
      if (stock >= 0) return;
      const [day, material] = key.split("__");
      const current = shortages.get(material);
      if (!current || Math.abs(stock) > current.quantity) shortages.set(material, { day, quantity: Math.abs(stock) });
    });
    return [...shortages.entries()].map(([material, risk]) => ({ material, ...risk })).sort((left, right) => left.day.localeCompare(right.day) || right.quantity - left.quantity);
  }, [rawStockByDayMaterial]);
  const monthlySales = useMemo(() => Object.values(salesItems.reduce<Record<string, { period: string; product: string; quantity: number }>>((all, item) => { const key = `${item.year}-${item.month}-${item.product_code}`; const row = all[key] ?? { period: `${item.year}-${String(item.month).padStart(2, "0")}`, product: item.product_code, quantity: 0 }; row.quantity += item.quantity_ton; all[key] = row; return all; }, {})), [salesItems]);
  const salesComparisonPeriods = useMemo(() => {
    if (!salesComparison) return [];
    const periods = new Map<string, SalesComparisonItem[]>();
    salesComparison.items.forEach((item) => {
      const period = `${item.year}-${String(item.month).padStart(2, "0")}`;
      periods.set(period, [...(periods.get(period) ?? []), item]);
    });
    return [...periods.entries()].map(([period, items]) => ({
      period,
      items: [...items].sort((left, right) => `${left.customer}\u0000${left.product_code}`.localeCompare(`${right.customer}\u0000${right.product_code}`, "ko", { numeric: true })),
    }));
  }, [salesComparison]);
  const basePeriod = `${planningYear}-${String(planningMonth).padStart(2, "0")}`;
  const dashboardSalesRows = useMemo(() => {
    const rows = Object.values(salesItems.filter((item) => planningPeriodSet.has(`${item.year}-${String(item.month).padStart(2, "0")}`)).reduce<Record<string, { product: string; customer: string; quantity: number }>>((all, item) => { const key = `${item.customer}__${item.product_code}`; const row = all[key] ?? { product: item.product_code, customer: item.customer, quantity: 0 }; row.quantity += item.quantity_ton; all[key] = row; return all; }, {})).sort((a, b) => `${a.customer}\u0000${a.product}`.localeCompare(`${b.customer}\u0000${b.product}`, "ko", { numeric: true }));
    return rows.map((row, index) => ({ ...row, customerSpan: index === 0 || rows[index - 1].customer !== row.customer ? rows.filter((item) => item.customer === row.customer).length : 0 }));
  }, [salesItems, planningPeriodSet]);
  const dashboardProductionRows = useMemo(() => {
    const rows = Object.values(scheduleItems.filter((item) => planningPeriodSet.has(item.planned_date.slice(0, 7))).reduce<Record<string, { process: string; plant: string; product: string; quantity: number }>>((all, item) => { const process = lineSpecifications.find((line) => line.code === item.line_code)?.process_code ?? "-"; const key = `${item.plant_name}__${process}__${item.product_code}`; const row = all[key] ?? { process, plant: item.plant_name, product: item.product_code, quantity: 0 }; row.quantity += item.planned_quantity_ton; all[key] = row; return all; }, {})).sort((a, b) => `${a.plant}\u0000${a.process}\u0000${a.product}`.localeCompare(`${b.plant}\u0000${b.process}\u0000${b.product}`, "ko", { numeric: true }));
    return rows.map((row, index) => ({ ...row, plantSpan: index === 0 || rows[index - 1].plant !== row.plant ? rows.filter((item) => item.plant === row.plant).length : 0, processSpan: index === 0 || rows[index - 1].plant !== row.plant || rows[index - 1].process !== row.process ? rows.filter((item) => item.plant === row.plant && item.process === row.process).length : 0 }));
  }, [scheduleItems, lineSpecifications, planningPeriodSet]);
  const dashboardInboundRows = useMemo(() => { const rows = new Map<string, number>(); productionDailyRows.forEach((row) => { if (!row.isTotal || !planningPeriodSet.has(row.day.slice(0, 7)) || !("values" in row)) return; row.values.forEach((value) => value.codes.forEach((code) => rows.set(code, (rows.get(code) ?? 0) + value.inbound / value.codes.length))); }); return [...rows.entries()].map(([code, quantity]) => ({ code, quantity })); }, [productionDailyRows, planningPeriodSet]);
  const calcinationSpecs = useMemo(() => lineSpecifications.filter((line) => line.process_code === "H").map((line) => { const items = scheduleItems.filter((item) => item.line_code === line.code && planningPeriodSet.has(item.planned_date.slice(0, 7))); const calendarHours = planningRangeDates.length * 24; const downtime = items.reduce((sum, item) => sum + item.downtime_hours, 0); const available = calendarHours - downtime; const utilization = items.reduce((sum, item) => sum + item.planned_quantity_ton, 0) / Math.max(items.reduce((sum, item) => sum + item.available_capacity_ton, 0), 1) * 100; return { ...line, calendarHours, downtime, available, utilization }; }), [lineSpecifications, scheduleItems, planningPeriodSet, planningRangeDates]);
  const dashboardCalcinationSpecs = useMemo(() => calcinationSpecs.map((line, index) => {
    const isFirstPlantRow = index === 0 || calcinationSpecs[index - 1].plant_name !== line.plant_name;
    let plantSpan = 0;
    if (isFirstPlantRow) for (let next = index; next < calcinationSpecs.length && calcinationSpecs[next].plant_name === line.plant_name; next += 1) plantSpan += 1;
    return { ...line, plantSpan };
  }), [calcinationSpecs]);
  const dashboardAlerts = useMemo(() => {
    const rawShortageByMaterial = new Map<string, number>();
    rawStockByDayMaterial.forEach((stock, key) => {
      if (stock >= 0) return;
      const materialCode = key.split("__").at(-1) ?? key;
      rawShortageByMaterial.set(materialCode, Math.max(rawShortageByMaterial.get(materialCode) ?? 0, Math.abs(stock)));
    });
    const rawShortages = rawShortageByMaterial.size;
    const rawShortageDetails = [...rawShortageByMaterial.entries()].sort(([, left], [, right]) => right - left).slice(0, 5).map(([code, quantity]) => `${code} ${formatDashboardNumber(quantity)}톤 부족`);
    const productWipShortageMap = new Map<string, number>();
    productInventoryFlowRows.forEach((row) => row.products.forEach((product) => product.processes.forEach((item) => {
      if (item.stock >= 0) return;
      const key = `${product.code}__${item.process}`;
      productWipShortageMap.set(key, Math.max(productWipShortageMap.get(key) ?? 0, Math.abs(item.stock)));
    })));
    const productWipShortages = productWipShortageMap.size;
    const productWipShortageDetails = [...productWipShortageMap.entries()].sort(([, left], [, right]) => right - left).slice(0, 5).map(([key, quantity]) => {
      const [code, process] = key.split("__");
      const processName = process === "H" ? "소성" : process === "S" ? "S처리" : process === "R" ? "재구형화" : process === "INBOUND" ? "제품" : process;
      return `${code} · ${processName} ${formatDashboardNumber(quantity)}톤 부족`;
    });
    const displayedStatus = scheduleMeta?.status === "검토 중" ? "저장" : scheduleMeta?.status;
    const unconfirmed = !scheduleRunId || displayedStatus !== "확정";
    return [
      { label: "계획 단계", value: unconfirmed ? (displayedStatus ?? "계획 없음") : "확정됨", description: unconfirmed ? "검토 후 확정해 주세요." : "현재 계획이 확정되었습니다.", details: [], tone: unconfirmed ? "warning" : "safe" },
      { label: "원료 부족", value: rawShortages ? `${rawShortages}건` : "정상", description: "", details: rawShortageDetails, tone: rawShortages ? "danger" : "safe" },
      { label: "제품/재공 부족", value: productWipShortages ? `${productWipShortages}건` : "정상", description: "", details: productWipShortageDetails, tone: productWipShortages ? "danger" : "safe" },
    ];
  }, [rawStockByDayMaterial, productInventoryFlowRows, scheduleMeta, scheduleRunId]);
  const dashboardPlanSummary = useMemo(() => {
    const summaries: string[] = [];
    requirements.filter((item) => item.required_production_ton > 0).sort((left, right) => right.required_production_ton - left.required_production_ton).slice(0, 2).forEach((item) => {
      summaries.push(`${item.product_code} 제품은 판매계획 ${formatDashboardNumber(item.sales_demand_ton)}톤, 출하가능 재고 ${formatDashboardNumber(item.available_inventory_ton)}톤, 안전재고 목표 ${formatDashboardNumber(item.safety_stock_target_ton)}톤을 반영해 ${formatDashboardNumber(item.required_production_ton)}톤 생산이 필요합니다.`);
    });
    const allocations = Object.values(scheduleItems.reduce<Record<string, { plant: string; line: string; product: string; quantity: number; capacity: number }>>((all, item) => {
      const key = `${item.plant_name}__${item.line_name}__${item.product_code}`;
      const allocation = all[key] ?? { plant: item.plant_name, line: item.line_name, product: item.product_code, quantity: 0, capacity: 0 };
      allocation.quantity += item.planned_quantity_ton;
      allocation.capacity += item.available_capacity_ton;
      all[key] = allocation;
      return all;
    }, {})).sort((left, right) => right.quantity - left.quantity).slice(0, 2);
    allocations.forEach((item) => summaries.push(`${item.plant} ${item.line} 라인에는 ${item.product} 제품 ${formatDashboardNumber(item.quantity)}톤을 배정했습니다. 이 라인의 계획 구간 가용 CAPA는 ${formatDashboardNumber(item.capacity)}톤입니다.`));
    const rawRisks = [...rawStockByDayMaterial.entries()].filter(([, stock]) => stock < 0).map(([key, stock]) => {
      const [day, material] = key.split("__");
      return { day, material, shortage: Math.abs(stock) };
    }).sort((left, right) => left.day.localeCompare(right.day) || right.shortage - left.shortage);
    if (rawRisks[0]) {
      const risk = rawRisks[0];
      summaries.push(`${Number(risk.day.slice(5, 7))}월 ${Number(risk.day.slice(8, 10))}일부터 전체 공장 기준 ${risk.material} 원료가 ${formatDashboardNumber(risk.shortage)}톤 부족할 것으로 예상됩니다.`);
    }
    const leadTimeItem = scheduleItems.map((item) => {
      const process = lineSpecifications.find((line) => line.code === item.line_code)?.process_code ?? "H";
      const quality = qualitySpecifications.find((spec) => spec.semi_product_code === `${item.product_code}_${process}`) ?? qualitySpecifications.find((spec) => spec.semi_product_code.startsWith(`${item.product_code}_`));
      return { item, quality };
    }).filter((row) => row.quality?.is_final_before_p && (row.quality.quality_inspection_days ?? 0) > 0).sort((left, right) => (right.quality?.quality_inspection_days ?? 0) - (left.quality?.quality_inspection_days ?? 0) || right.item.planned_quantity_ton - left.item.planned_quantity_ton)[0];
    if (leadTimeItem?.quality) {
      const completion = new Date(`${leadTimeItem.item.planned_date}T00:00:00`);
      completion.setDate(completion.getDate() + leadTimeItem.quality.quality_inspection_days);
      summaries.push(`${leadTimeItem.item.plant_name} ${leadTimeItem.item.line_name} 라인의 ${leadTimeItem.item.product_code} 제품은 품질검사 ${leadTimeItem.quality.quality_inspection_days}일이 필요해 ${Number(leadTimeItem.item.planned_date.slice(5, 7))}월 ${Number(leadTimeItem.item.planned_date.slice(8, 10))}일 생산분이 ${completion.getMonth() + 1}월 ${completion.getDate()}일 입고로 반영됩니다.`);
    }
    return summaries.slice(0, 6);
  }, [requirements, scheduleItems, rawStockByDayMaterial, lineSpecifications, qualitySpecifications]);

  async function saveEfficiency(line: LineSpecification) {
    const response = await fetch(`${API_URL}/specifications/lines/${line.code}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operating_efficiency: line.operating_efficiency ?? 0 }) });
    const result = await response.json();
    if (!response.ok) { setError(result.detail ?? "제원치를 저장하지 못했습니다."); return; }
    setLineSpecifications((items) => items.map((item) => item.code === line.code ? result : item));
  }

  async function confirmPlanningRange() {
    setError("");
    try {
      const response = await fetch(`${API_URL}/sales/items`);
      if (!response.ok) throw new Error("현재 적용 판매계획을 불러오지 못했습니다.");
      const currentSales = await response.json() as SalesItem[];
      const missingPeriods = planPeriods.filter((period) => !currentSales.some((item) => period === `${item.year}-${String(item.month).padStart(2, "0")}`));
      if (missingPeriods.length) throw new Error(`${missingPeriods.join(", ")} 판매계획이 없습니다. 데이터 업로드에서 판매계획 파일을 등록하거나 적용 파일을 변경해 주세요.`);
      const startDate = yesterdayValue();
      setDailyStartDate(startDate);
      window.localStorage.setItem("production-planning-range", JSON.stringify({ year: planningYear, month: planningMonth, endYear: planningEndYear, endMonth: planningEndMonth, dailyStartDate: startDate, confirmed: true }));
      setSalesItems(currentSales); setIsRangeConfirmed(true);
      setMessage(`${planningYear}년 ${planningMonth}월부터 ${planningEndYear}년 ${planningEndMonth}월 생산계획 구간을 확정했습니다.`);
      setIsPlanningSelectorOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "생산계획 구간을 확정하지 못했습니다.");
    }
  }

  function resetPlanningScreen() {
    window.localStorage.removeItem("production-planning-range");
    window.localStorage.setItem("production-planning-reset", "true");
    setIsPlanningStarted(false); setIsRangeConfirmed(false); setRequirements([]); setPlanningRunId(null); setScheduleItems([]); setScheduleShortages([]); setScheduleRunId(null); setScheduleMeta(null); setRawMaterialBalances([]); setIsRequirementModalOpen(false); setIsInitialScheduleModalOpen(false); setError("");
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${API_URL}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.detail ?? "제품을 저장하지 못했습니다.");
      return;
    }
    setCode("");
    setName("");
    await loadProducts();
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`${product.code} 제품 기준정보를 삭제할까요? 기존 계획·재고·스케줄 이력은 유지됩니다.`)) return;
    setError("");
    const response = await fetch(`${API_URL}/products/${product.id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json();
      setError(result.detail ?? "제품을 삭제하지 못했습니다.");
      return;
    }
    await loadProducts();
  }

  async function refreshDataAfterDeletion() {
    const statuses = await fetch(`${API_URL}/data-status`);
    setDataStatuses(statuses.ok ? await statuses.json() : []);
    await Promise.all([
      loadSalesItems().catch(() => undefined),
      loadSalesImports().catch(() => undefined),
      fetch(`${API_URL}/inventories/product/items`).then((r) => r.ok ? r.json() : []).then(setProductInventory),
      fetch(`${API_URL}/inventories/raw/items`).then((r) => r.ok ? r.json() : []).then(setRawInventory),
      fetch(`${API_URL}/inventories/raw-inbound/items`).then((r) => r.ok ? r.json() : []).then(setRawInboundItems),
    ]);
  }

  async function deleteImport(status: DataStatus, importId: number) {
    const selected = status.history.find((row) => row.id === importId);
    if (!selected) return;
    const masterNotice = status.name === "Master" ? "\n\n참고: 현재 적용된 공장·라인·BOM 기준정보는 유지됩니다. 이 버튼은 업로드 이력과 원본 행만 삭제합니다." : "";
    if (!window.confirm(`'${selected.file_name}' 업로드 이력과 적재된 상세 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.${masterNotice}`)) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/data-status/${encodeURIComponent(status.name)}/${importId}`, { method: "DELETE" });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("삭제 기능이 반영된 백엔드를 찾을 수 없습니다. 프로그램을 완전히 종료한 뒤 다시 실행해 주세요.");
        }
        const result = await response.json();
        throw new Error(result.detail ?? "업로드 데이터를 삭제하지 못했습니다.");
      }
      setSelectedImports((current) => { const next = { ...current }; delete next[status.name]; return next; });
      await refreshDataAfterDeletion();
      setMessage(`'${selected.file_name}' 업로드 데이터를 삭제했습니다.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "업로드 데이터를 삭제하지 못했습니다.");
    }
  }

  async function deletePlanningRun() {
    if (!planningRunId) return;
    if (!window.confirm("현재 필요 생산량 계산과 이 계산에서 생성된 모든 생산 스케줄·버전·원료검증 결과를 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/planning/runs/${planningRunId}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail ?? "생산계획을 삭제하지 못했습니다.");
      }
      setRequirements([]); setPlanningRunId(null); setScheduleItems([]); setScheduleShortages([]); setScheduleRunId(null); setScheduleMeta(null); setRawMaterialBalances([]); setIsRequirementModalOpen(false); setIsInitialScheduleModalOpen(false); setIsPlanningStarted(false);
      const versions = await fetch(`${API_URL}/scheduler/runs/versions`);
      setScheduleVersions(versions.ok ? await versions.json() : []);
      setMessage("생산계획과 연결된 스케줄 데이터를 삭제했습니다.");
      router.push("/");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "생산계획을 삭제하지 못했습니다.");
    }
  }

  async function loadSchedulesByStatus(status: string) {
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/runs?status=${encodeURIComponent(status)}`);
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.detail ?? "생산계획 이력을 불러오지 못했습니다.");
      setLoadableSchedules(rows);
      setSelectedLoadScheduleId(rows[0]?.id ?? null);
    } catch (requestError) {
      setLoadableSchedules([]); setSelectedLoadScheduleId(null);
      setError(requestError instanceof Error ? requestError.message : "생산계획 이력을 불러오지 못했습니다.");
    }
  }

  async function togglePlanLoader() {
    if (!isPlanLoadOpen) await loadSchedulesByStatus(planLoadStatus);
    setIsPlanLoadOpen((open) => !open);
  }

  async function loadSelectedSchedule() {
    if (!selectedLoadScheduleId) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/runs/${selectedLoadScheduleId}`);
      const schedule = await response.json();
      if (!response.ok) throw new Error(schedule.detail ?? "생산계획을 불러오지 못했습니다.");
      const planningResponse = await fetch(`${API_URL}/planning/runs/${schedule.planning_run_id}`);
      const planning = planningResponse.ok ? await planningResponse.json() : null;
      const selected = loadableSchedules.find((item) => item.id === selectedLoadScheduleId);
      const source = planning ?? selected;
      if (source) {
        setPlanningYear(source.year ?? source.planning_year); setPlanningMonth(source.month ?? source.planning_month);
        setPlanningEndYear(source.end_year ?? source.planning_end_year); setPlanningEndMonth(source.end_month ?? source.planning_end_month);
        setCalendarYear(source.year ?? source.planning_year); setIsRangeConfirmed(true);
      }
      setPlanningRunId(schedule.planning_run_id); setScheduleRunId(schedule.id); setScheduleMeta(schedule); setScheduleItems(schedule.items); setScheduleShortages(schedule.shortages); setRequirements(planning?.requirements ?? []); setRawMaterialBalances([]); setIsPlanningStarted(true); setIsPlanLoadOpen(false);
      await loadScheduleChangeHistory(schedule.id);
      const validation = await fetch(`${API_URL}/scheduler/runs/${schedule.id}/raw-material-validation`, { method: "POST" });
      if (validation.ok) setRawMaterialBalances((await validation.json()).balances);
      setMessage(`V${schedule.version} · ${schedule.status === "검토 중" ? "저장" : schedule.status} 생산계획을 불러왔습니다.`);
      router.push("/production/daily");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "생산계획을 불러오지 못했습니다.");
    }
  }

  async function importMaster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("masterFile") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setIsImporting(true);
    setError("");
    setImportResult(null);
    const body = new FormData();
    body.append("file", input.files[0]);
    try {
      const response = await fetch(`${API_URL}/master-imports`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "Master 파일을 등록하지 못했습니다.");
      setImportResult(result);
      await loadProducts();
      form.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Master 파일을 등록하지 못했습니다.");
    } finally {
      setIsImporting(false);
    }
  }

  async function loadSalesItems() {
    const response = await fetch(`${API_URL}/sales/items`);
    if (!response.ok) throw new Error("판매계획을 불러올 수 없습니다.");
    setSalesItems(await response.json());
  }

  async function loadSalesImports() {
    const response = await fetch(`${API_URL}/sales/imports`);
    if (!response.ok) throw new Error("판매계획 업로드 이력을 불러올 수 없습니다.");
    const imports = await response.json() as SalesImport[];
    setSalesImports(imports);
    if (imports.length >= 2) {
      setCompareSalesImportId((current) => current ?? imports[0].id);
      setBaseSalesImportId((current) => current ?? imports[1].id);
    }
  }

  async function compareSalesPlans() {
    if (!baseSalesImportId || !compareSalesImportId) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/sales/comparison?base_import_id=${baseSalesImportId}&compare_import_id=${compareSalesImportId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "판매계획 비교 결과를 불러오지 못했습니다.");
      setSalesComparison(result);
    } catch (requestError) {
      setSalesComparison(null);
      setError(requestError instanceof Error ? requestError.message : "판매계획 비교 결과를 불러오지 못했습니다.");
    }
  }

  async function compareScheduleVersions() {
    if (!baseScheduleVersionId || !compareScheduleVersionId) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/runs/compare?base_id=${baseScheduleVersionId}&compare_id=${compareScheduleVersionId}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "생산계획 버전 비교 결과를 불러오지 못했습니다.");
      setScheduleVersionComparison(result);
    } catch (requestError) {
      setScheduleVersionComparison(null);
      setError(requestError instanceof Error ? requestError.message : "생산계획 버전 비교 결과를 불러오지 못했습니다.");
    }
  }

  async function importSales(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("salesFile") as HTMLInputElement;
    if (!input.files?.[0]) return;
    const file = input.files[0];
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (!salesValidation || salesValidation.fileKey !== fileKey || !salesValidation.valid) {
      setError("판매계획 파일을 먼저 검증하고 오류를 모두 해결해 주세요.");
      return;
    }
    setIsSalesImporting(true);
    setError("");
    const body = new FormData();
    body.append("file", input.files[0]);
    try {
      const response = await fetch(`${API_URL}/sales/imports`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "판매계획을 등록하지 못했습니다.");
      setSalesImport(result);
      await loadSalesItems();
      await loadSalesImports();
      form.reset();
      setSalesValidation(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "판매계획을 등록하지 못했습니다.");
    } finally {
      setIsSalesImporting(false);
    }
  }

  async function validateSalesFile() {
    const file = salesFileInputRef.current?.files?.[0];
    if (!file) { setError("검증할 판매계획 Excel 파일을 선택해 주세요."); return; }
    setIsSalesValidating(true); setError("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API_URL}/sales/imports/validate`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "판매계획 파일을 검증하지 못했습니다.");
      setSalesValidation({ ...result, fileKey: `${file.name}:${file.size}:${file.lastModified}` });
    } catch (requestError) {
      setSalesValidation(null);
      setError(requestError instanceof Error ? requestError.message : "판매계획 파일을 검증하지 못했습니다.");
    } finally { setIsSalesValidating(false); }
  }

  async function downloadSalesValidationReport() {
    const file = salesFileInputRef.current?.files?.[0];
    if (!file) return;
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API_URL}/sales/imports/validation-report`, { method: "POST", body });
      if (!response.ok) throw new Error("오류 Excel을 만들지 못했습니다.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = "sales_plan_validation_errors.xlsx"; link.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "오류 Excel을 만들지 못했습니다."); }
  }

  async function importInventory(event: FormEvent<HTMLFormElement>, kind: "product" | "raw") {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem(`${kind}InventoryFile`) as HTMLInputElement;
    if (!input.files?.[0]) return;
    setError("");
    const body = new FormData();
    body.append("file", input.files[0]);
    try {
      const response = await fetch(`${API_URL}/inventories/${kind}/imports`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "재고 파일을 등록하지 못했습니다.");
      if (kind === "product") {
        setProductInventoryImport(result);
        const items = await fetch(`${API_URL}/inventories/product/items`);
        setProductInventory(await items.json());
      } else {
        setRawInventoryImport(result);
        const items = await fetch(`${API_URL}/inventories/raw/items`);
        setRawInventory(await items.json());
      }
      form.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "재고 파일을 등록하지 못했습니다.");
    }
  }

  async function importOperations(event: FormEvent<HTMLFormElement>, kind: "raw-inbound") {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("raw-inboundFile") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setError("");
    const body = new FormData();
    body.append("file", input.files[0]);
    try {
      const response = await fetch(`${API_URL}/inventories/raw-inbound/imports?merge=true`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "운영 파일을 등록하지 못했습니다.");
      setRawInboundImport(result);
      const items = await fetch(`${API_URL}/inventories/raw-inbound/items`);
      if (items.ok) setRawInboundItems(await items.json());
      form.reset();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "운영 파일을 등록하지 못했습니다.");
    }
  }

  async function createPlanningRun(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!isRangeConfirmed) {
      setError("생산계획 구간을 먼저 확정해 주세요.");
      return;
    }
    setError("");
    try {
      const response = await fetch(`${API_URL}/planning/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: planningYear, month: planningMonth, end_year: planningEndYear, end_month: planningEndMonth }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "필요 생산량을 계산하지 못했습니다.");
      setRequirements(result.requirements);
      setPlanningRunId(result.id);
      setScheduleItems([]);
      setScheduleShortages([]);
      setScheduleRunId(null);
      setRawMaterialBalances([]);
      setIsRequirementModalOpen(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "필요 생산량을 계산하지 못했습니다.");
    }
  }

  function openInitialScheduleModal() {
    setIsInitialScheduleModalOpen(true);
  }

  async function createSchedule(mode = planningMode) {
    if (!planningRunId) return;
    setError("");
    try {
      const conditions = planningRangeDates.flatMap((planned_date) => lineSpecifications.map((line) => ({ planned_date, line_code: line.code, ...(initialScheduleConditions[`${planned_date}__${line.code}`] ?? { operation_status: "가동", downtime_hours: 0 }) })));
      const response = await fetch(`${API_URL}/scheduler/runs/${planningRunId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conditions, planning_mode: mode }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "생산 스케줄을 만들지 못했습니다.");
      setScheduleItems(result.items);
      setScheduleShortages(result.shortages);
      setScheduleRunId(result.id);
      setScheduleMeta(result);
      setPlanningMode(result.planning_mode ?? mode);
      setRawMaterialBalances([]);
      setIsRequirementModalOpen(false);
      setIsInitialScheduleModalOpen(false);
      window.localStorage.removeItem("production-planning-reset");
      setIsPlanningStarted(true);
      router.push("/production/daily");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "생산 스케줄을 만들지 못했습니다.");
    }
  }

  async function uploadInboundAndRecalculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = rawInboundAlertInputRef.current?.files?.[0];
    if (!file) { setError("변경된 원료 입고계획 Excel 파일을 선택해 주세요."); return; }
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(`${API_URL}/inventories/raw-inbound/imports?merge=true`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "원료 입고계획을 등록하지 못했습니다.");
      setRawInboundImport(result);
      const items = await fetch(`${API_URL}/inventories/raw-inbound/items`);
      if (items.ok) setRawInboundItems(await items.json());
      await createSchedule("원료 제약 반영");
      setMessage("변경된 원료 입고계획을 적용해 원료 제약 생산계획을 다시 계산했습니다.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "원료 입고계획을 적용하지 못했습니다.");
    }
  }

  async function downloadScheduleExcel() {
    if (scheduleMeta?.status !== "확정") {
      setError("Excel 다운로드는 확정된 생산계획 버전에서만 할 수 있습니다.");
      return;
    }
    if (!scheduleRunId) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/export`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail ?? "Excel 파일을 만들지 못했습니다.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `confirmed_production_plan_${scheduleRunId}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Excel 파일을 만들지 못했습니다.");
    }
  }

  async function validateRawMaterials() {
    if (!scheduleRunId) return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/raw-material-validation`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "원료 가용성을 검증하지 못했습니다.");
      setRawMaterialBalances(result.balances);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "원료 가용성을 검증하지 못했습니다.");
    }
  }

  function changeScheduleItem(itemId: number, changes: Partial<ScheduleItem>) {
    setScheduleItems((items) => items.map((item) => item.id === itemId ? { ...item, ...changes } : item));
  }

  async function loadScheduleChangeHistory(scheduleId: number) {
    const response = await fetch(`${API_URL}/scheduler/runs/${scheduleId}/change-history`);
    if (response.ok) setScheduleChangeHistory(await response.json());
  }

  async function saveScheduleItem(item: ScheduleItem) {
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planned_date: item.planned_date, product_code: item.product_code, planned_quantity_ton: item.planned_quantity_ton, downtime_hours: item.downtime_hours, work_rate: item.work_rate * 100, operation_status: item.operation_status, is_locked: item.is_locked, adjustment_note: item.adjustment_note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "스케줄을 저장하지 못했습니다.");
      setScheduleItems(result.items);
      setScheduleShortages(result.shortages);
      setRawMaterialBalances([]);
      if (scheduleRunId) await loadScheduleChangeHistory(scheduleRunId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "스케줄을 저장하지 못했습니다.");
    }
  }

  async function saveAllScheduleItems() {
    if (!scheduleRunId || scheduleMeta?.status === "확정") return;
    setError("");
    try {
      for (const item of scheduleItems) {
        const response = await fetch(`${API_URL}/scheduler/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planned_date: item.planned_date, product_code: item.product_code, planned_quantity_ton: item.planned_quantity_ton, downtime_hours: item.downtime_hours, work_rate: item.work_rate * 100, operation_status: item.operation_status, is_locked: item.is_locked, adjustment_note: scheduleChangeReason || item.adjustment_note }) });
        if (!response.ok) throw new Error("생산계획을 저장하지 못했습니다.");
      }
      const latest = await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}`).then((response) => response.json());
      setScheduleItems(latest.items); setScheduleShortages(latest.shortages);
      setMessage("수정한 생산계획을 저장했습니다.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "생산계획을 저장하지 못했습니다."); }
  }

  async function recalculateScheduleItem(itemId: number) {
    const item = scheduleItems.find((row) => row.id === itemId);
    if (!item || scheduleMeta?.status === "확정") return;
    setError("");
    try {
      const response = await fetch(`${API_URL}/scheduler/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planned_date: item.planned_date, product_code: item.product_code, downtime_hours: item.downtime_hours, work_rate: item.work_rate * 100, operation_status: item.operation_status, auto_calculate: true, is_locked: item.is_locked, adjustment_note: scheduleChangeReason || item.adjustment_note }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "생산량을 다시 계산하지 못했습니다.");
      setScheduleItems(result.items); setScheduleShortages(result.shortages); setRawMaterialBalances([]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "생산량을 다시 계산하지 못했습니다."); }
  }

  async function createScheduleItem(day: string, line: { code: string }, draft: { product_code: string; downtime_hours: number; work_rate: number; operation_status: string }) {
    if (!scheduleRunId || !draft.product_code.trim()) { setError("새 계획의 반제품코드를 입력해 주세요."); return; }
    try {
      const response = await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line_code: line.code, planned_date: day, product_code: draft.product_code.toUpperCase(), downtime_hours: draft.downtime_hours, work_rate: draft.work_rate, operation_status: draft.operation_status, auto_calculate: true, adjustment_note: scheduleChangeReason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "새 생산계획을 만들지 못했습니다.");
      setScheduleItems(result.items); setScheduleShortages(result.shortages);
      setDraftScheduleCells((cells) => { const next = { ...cells }; delete next[`${day}__${line.code}`]; return next; });
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "새 생산계획을 만들지 못했습니다."); }
  }

  function itemYield(item: ScheduleItem, process: string) {
    return qualitySpecifications.find((spec) => spec.semi_product_code === `${item.product_code}_${process}`)?.production_yield ?? item.yield_rate ?? 1;
  }

  async function importActuals(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form=event.currentTarget; const input=form.elements.namedItem("actualFile") as HTMLInputElement; if(!input.files?.[0]) return; const body=new FormData(); body.append("file",input.files[0]); const response=await fetch(`${API_URL}/production-actuals/imports`,{method:"POST",body}); const result=await response.json(); if(!response.ok){setError(result.detail??"생산실적 등록 실패");return;} setActualImport(result); form.reset(); }
  async function loadActualComparison() { if(!scheduleRunId)return; const response=await fetch(`${API_URL}/production-actuals/comparison/${scheduleRunId}`); const result=await response.json(); if(!response.ok){setError(result.detail??"실적 조회 실패");return;} setActualComparison(result.rows); }
  async function rescheduleShortfalls() { if(!scheduleRunId)return; const response=await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/reschedule`,{method:"POST"}); const result=await response.json(); if(!response.ok){setError(result.detail??"재스케줄 실패");return;} setScheduleItems(result.items); setScheduleShortages(result.shortages); setActualComparison([]); setRawMaterialBalances([]); }
  async function setScheduleStatus(status:string) { if(!scheduleRunId)return; const response=await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/status`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,change_reason:scheduleChangeReason || scheduleMeta?.change_reason || ""})}); const result=await response.json(); if(!response.ok){setError(result.detail??"상태 변경 실패");return;} setScheduleMeta(result); setScheduleItems(result.items); }
  async function copyScheduleVersion() { if(!scheduleRunId)return; if(!scheduleChangeReason.trim()){setError("새 버전 생성 사유를 입력해 주세요.");return;} const response=await fetch(`${API_URL}/scheduler/runs/${scheduleRunId}/copy`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({change_reason:scheduleChangeReason.trim()})}); const result=await response.json(); if(!response.ok){setError(result.detail??"새 버전 생성 실패");return;} setScheduleRunId(result.id); setScheduleMeta(result); setScheduleItems(result.items); setScheduleShortages(result.shortages); setScheduleChangeReason(""); fetch(`${API_URL}/scheduler/runs/versions`).then((r) => r.ok ? r.json() : []).then(setScheduleVersions).catch(() => undefined); }
  async function activateImport(source_type:string, import_id:number) { const response=await fetch(`${API_URL}/data-status/activate`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({source_type,import_id})}); if(!response.ok){setError("적용 파일 변경 실패");return;} const statuses=await fetch(`${API_URL}/data-status`).then((r)=>r.json()); setDataStatuses(statuses); }
  function toggleUploadTable(name: string) { setExpandedUploadTables((tables) => ({ ...tables, [name]: !tables[name] })); }

  return (
    <main className={`view-${view}${isPlanningStarted ? "" : " planning-not-started"}`}>
      <header className="app-header"><h1>{planningYear}년 {planningMonth}월 {pageName[view] ?? "생산계획"}</h1></header>
      {(view === "spec-monthly" || view === "spec-daily") && <section className="card spec-filter-card"><div className="daily-filters"><label>공장<select value={dailyPlantFilter} onChange={(event) => { setDailyPlantFilter(event.target.value); setDailyProcessFilter("all"); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.map((line) => line.plant_name))].map((plant) => <option key={plant} value={plant}>{plant}</option>)}</select></label><label>공정<select value={dailyProcessFilter} onChange={(event) => { setDailyProcessFilter(event.target.value); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.filter((line) => dailyPlantFilter === "all" || line.plant_name === dailyPlantFilter).map((line) => line.process_code))].map((process) => <option key={process} value={process}>{processLabel(process)}</option>)}</select></label><label>라인<select value={dailyLineFilter} onChange={(event) => setDailyLineFilter(event.target.value)}><option value="all">전체</option>{dailyLines.map((line) => <option key={line.code} value={line.line}>{line.line}</option>)}</select></label></div></section>}
      <aside className="planning-sidebar">
        <button type="button" className="company-ci" onClick={resetPlanningScreen} aria-label="생산계획 초기화"><img src="/poscofuturem-ci.jpg" alt="POSCO FUTURE M"/></button>
        <section className="planning-selector">
          <div className="planning-selector-header"><h2>생산계획 기준월</h2><button type="button" className="selector-toggle" onClick={() => setIsPlanningSelectorOpen((open) => !open)}>{isPlanningSelectorOpen ? "접기" : "펼치기"}</button></div>
          {isPlanningSelectorOpen ? <><div className="month-calendar"><div className="calendar-year"><button type="button" onClick={() => setCalendarYear((year) => year - 1)}>‹</button><strong>{calendarYear}년</strong><button type="button" onClick={() => setCalendarYear((year) => year + 1)}>›</button></div><div className="month-grid">{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <button type="button" key={month} className={calendarYear === planningYear && month === planningMonth ? "selected-month" : ""} onClick={() => { const end = addMonths(calendarYear, month, 2); setPlanningYear(calendarYear); setPlanningMonth(month); setPlanningEndYear(end.year); setPlanningEndMonth(end.month); setIsRangeConfirmed(false); }}>{month}월</button>)}</div></div>
          <p className="muted">{isRangeConfirmed ? "구간 확정" : scheduleMeta?.status ?? "미확정"}</p>
          <h2>생산계획 구간</h2><label>From</label><p className="readonly-period">{planningYear}년 {planningMonth}월</p><label>To</label><input className="range-end-picker" type="month" min={periodValue(planningYear, planningMonth)} value={periodValue(planningEndYear, planningEndMonth)} onChange={(event) => { const [year, month] = event.target.value.split("-").map(Number); if ((year > planningYear) || (year === planningYear && month >= planningMonth)) { setPlanningEndYear(year); setPlanningEndMonth(month); setIsRangeConfirmed(false); } }} />
          <button type="button" className="range-confirm-button" onClick={confirmPlanningRange}>{isRangeConfirmed ? "구간 확정 완료" : "구간 확정"}</button></> : <p className="collapsed-range">{planningYear}년 {planningMonth}월 ~ {planningEndYear}년 {planningEndMonth}월</p>}
          <button type="button" className="requirement-calculate-button" disabled={!isRangeConfirmed} onClick={() => createPlanningRun()}>필요 생산량 계산</button>
          {error && <p className="sidebar-error">{error}</p>}
        </section>
        <nav className="side-menu"><a href="/">▦ 대시보드</a><details open><summary>판매계획</summary><a href="/sales/monthly">월별 계획</a><a href="/sales/daily">일별 계획</a></details><details open><summary>생산계획</summary><a href="/production/monthly">월별 계획</a><a href="/production/daily">일별 계획</a><details><summary>제원치</summary><a href="/spec/monthly">월별 계획</a><a href="/spec/daily">일별 계획</a></details></details><a href="/product-inventory">제품재고</a><a href="/raw-inventory">원료재고</a><details open><summary>데이터</summary><a href="/data/upload">데이터 업로드</a><a href="/data/compare">데이터 비교</a></details></nav>
        <section className="sidebar-plan-actions">
          {planningRunId && <button type="button" className="delete-button planning-delete-button" onClick={deletePlanningRun}>현재 생산계획 삭제</button>}
          <button type="button" className="plan-load-toggle" onClick={togglePlanLoader}>생산계획 불러오기</button>
          {isPlanLoadOpen && <div className="plan-load-panel"><label>상태<select value={planLoadStatus} onChange={(event) => { const status = event.target.value; setPlanLoadStatus(status); loadSchedulesByStatus(status); }}><option value="확정">확정</option><option value="저장">저장</option><option value="작성 중">작성 중</option></select></label><label>생산계획<select value={selectedLoadScheduleId ?? ""} onChange={(event) => setSelectedLoadScheduleId(Number(event.target.value))} disabled={!loadableSchedules.length}><option value="">{loadableSchedules.length ? "생산계획 선택" : `${planLoadStatus} 상태의 계획이 없습니다.`}</option>{loadableSchedules.map((item) => <option key={item.id} value={item.id}>V{item.version} · {item.planning_year}.{String(item.planning_month).padStart(2, "0")}~{item.planning_end_year}.{String(item.planning_end_month).padStart(2, "0")} · {new Date(item.created_at).toLocaleString("ko-KR")}</option>)}</select></label><button type="button" className="plan-load-button" disabled={!selectedLoadScheduleId} onClick={loadSelectedSchedule}>조회</button></div>}
        </section>
      </aside>
      {!isPlanningStarted && <section className="planning-start-placeholder">생산계획을 시작하세요</section>}
      <section className="card overview">
        <section className="dashboard-alert-section">
          <h2>계획 경고 및 알림</h2>
          <div className="dashboard-alert-grid">{dashboardAlerts.map((alert) => <div key={alert.label} className={`dashboard-alert ${alert.tone} ${alert.details.length ? "has-details" : ""}`}><div className="dashboard-alert-summary"><span>{alert.label}</span><strong>{alert.value}</strong>{alert.description && <p>{alert.description}</p>}</div>{alert.details.length > 0 && <ul className="dashboard-alert-details">{alert.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}</div>)}</div>
        </section>
        {rawSupplyRisks.length > 0 && <section className="raw-resupply-alert"><div><h2>원료 추가 수급 및 생산 재계산 필요</h2><p>{scheduleMeta?.planning_mode === "원료 제약 반영" ? "원료 재고·입고계획 제약을 반영한 결과입니다. 변경된 입고계획을 등록하면 같은 기준월로 생산량을 다시 최적화합니다." : "현재 계획에서 원료 부족이 예상됩니다. 변경된 입고계획을 등록하면 원료 제약 반영 방식으로 생산량을 다시 최적화합니다."}</p><ul>{scheduleShortages.filter((item) => item.unallocated_quantity_ton > 0).slice(0, 5).map((item) => <li key={`shortage-${item.id}`}>{item.product_code} 제품 {item.unallocated_quantity_ton.toFixed(1)}톤 미배정</li>)}{!scheduleShortages.some((item) => item.unallocated_quantity_ton > 0) && rawSupplyRisks.slice(0, 5).map((risk) => <li key={`${risk.material}-${risk.day}`}>{Number(risk.day.slice(5, 7))}월 {Number(risk.day.slice(8, 10))}일 {risk.material} 원료 {formatDashboardNumber(risk.quantity)}톤 부족 예상</li>)}</ul></div><form onSubmit={uploadInboundAndRecalculate}><label>변경된 원료 입고계획 Excel<input ref={rawInboundAlertInputRef} type="file" accept=".xlsx" required /></label><button type="submit">입고계획 적용 후 재계산</button></form></section>}
        <h2>{planningYear}년 {planningMonth}월 판매/생산 Summary</h2>
        <div className="dashboard-summary-grid">
          <div><h3>월별 판매량</h3><div className="table-wrap summary-table"><table><thead><tr><th>고객사</th><th>제품</th><th>판매량</th></tr></thead><tbody>{dashboardSalesRows.map((row) => <tr key={`${row.customer}-${row.product}`}>{row.customerSpan > 0 && <td rowSpan={row.customerSpan}>{row.customer}</td>}<td>{row.product}</td><td>{row.quantity.toFixed(1)}</td></tr>)}{!dashboardSalesRows.length && <tr><td colSpan={3}>판매계획이 없습니다.</td></tr>}</tbody></table></div></div>
          <div><h3>공정별 생산량</h3><div className="table-wrap summary-table"><table><thead><tr><th>공장</th><th>공정</th><th>제품코드</th><th>생산량</th></tr></thead><tbody>{dashboardProductionRows.map((row) => <tr key={`${row.process}-${row.plant}-${row.product}`}>{row.plantSpan > 0 && <td rowSpan={row.plantSpan}>{row.plant}</td>}{row.processSpan > 0 && <td rowSpan={row.processSpan}>{row.process === "H" ? "소성" : row.process === "S" ? "S처리" : row.process === "R" ? "재구형화" : row.process}</td>}<td>{row.product}</td><td>{row.quantity.toFixed(1)}</td></tr>)}{!dashboardProductionRows.length && <tr><td colSpan={4}>생산계획이 없습니다.</td></tr>}</tbody></table></div></div>
          <div><h3>월별 입고량</h3><div className="table-wrap summary-table"><table><thead><tr><th>반제품코드</th><th>입고량</th></tr></thead><tbody>{dashboardInboundRows.map((row) => <tr key={row.code}><td>{row.code}</td><td>{row.quantity.toFixed(1)}</td></tr>)}{!dashboardInboundRows.length && <tr><td colSpan={2}>품질검사 완료 입고가 없습니다.</td></tr>}</tbody></table></div></div>
        </div>
        <section className="dashboard-plan-summary">
          <h2>생산계획 요약</h2>
          {dashboardPlanSummary.length ? <ol>{dashboardPlanSummary.map((summary, index) => <li key={index}>{summary}</li>)}</ol> : <p>생산계획을 생성하면 판매계획, 재고, 라인 배정, 원료 및 품질검사 기준의 요약을 보여드립니다.</p>}
        </section>
        <h2>{planningYear}년 {planningMonth}월 생산계획 제원치</h2>
        <div className="table-wrap summary-spec-table dashboard-spec-table"><table><thead><tr><th>공장</th><th>라인</th><th>역시간</th><th>휴지시간</th><th>작업가능시간</th><th>순작업시간</th><th>가동률(%)</th><th>작업률(%)</th></tr></thead><tbody>{dashboardCalcinationSpecs.map((line) => <tr key={line.code}>{line.plantSpan > 0 && <td rowSpan={line.plantSpan}>{line.plant_name}</td>}<td>{line.name}</td><td>{formatDashboardNumber(line.calendarHours)}</td><td>{formatDashboardNumber(line.downtime)}</td><td>{formatDashboardNumber(line.available)}</td><td>{formatDashboardNumber(line.available)}</td><td>{line.utilization ? `${formatDashboardNumber(line.utilization)}%` : "-"}</td><td>{line.operating_efficiency ? `${formatDashboardNumber(line.operating_efficiency * 100)}%` : "-"}</td></tr>)}{!dashboardCalcinationSpecs.length && <tr><td colSpan={8}>소성공정 제원치가 없습니다.</td></tr>}</tbody></table></div>
      </section>
      {isRequirementModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsRequirementModalOpen(false)}><section className="requirement-modal" role="dialog" aria-modal="true" aria-labelledby="requirement-modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="requirement-modal-header"><div><h2 id="requirement-modal-title">월별 필요 생산량</h2><p>{planningYear}년 {planningMonth}월 ~ {planningEndYear}년 {planningEndMonth}월 기준</p></div><button type="button" className="modal-close-button" aria-label="팝업 닫기" onClick={() => setIsRequirementModalOpen(false)}>×</button></div><p>필요 생산량 = 판매계획 − 출하가능 재고 + 안전재고 목표량입니다.</p><div className="table-wrap requirement-modal-table"><table><thead><tr><th>제품</th><th>판매계획(t)</th><th>출하가능 재고(t)</th><th>안전일수</th><th>구간 평균 일판매(t)</th><th>안전재고 목표(t)</th><th>필요 생산량(t)</th></tr></thead><tbody>{requirements.map((item) => <tr key={item.id}><td>{item.product_code}</td><td>{item.sales_demand_ton.toLocaleString()}</td><td>{item.available_inventory_ton.toLocaleString()}</td><td>{item.safety_stock_days.toLocaleString()}</td><td>{item.average_daily_sales_ton.toFixed(2)}</td><td>{item.safety_stock_target_ton.toFixed(2)}</td><td><strong>{item.required_production_ton.toFixed(2)}</strong></td></tr>)}{!requirements.length && <tr><td colSpan={7}>계산된 필요 생산량이 없습니다.</td></tr>}</tbody></table></div><div className="requirement-modal-actions"><button type="button" className="scheduler-button" disabled={!planningRunId} onClick={openInitialScheduleModal}>라인·일자별 초기 스케줄 생성</button></div></section></div>}
      {isInitialScheduleModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsInitialScheduleModalOpen(false)}><section className="requirement-modal initial-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="initial-schedule-modal-title" onMouseDown={(event) => event.stopPropagation()}><div className="requirement-modal-header"><div><h2 id="initial-schedule-modal-title">라인·일자별 설비 가동계획</h2><p>가동여부와 휴지시간(0~24시간)을 입력한 뒤 초기 스케줄을 생성하세요.</p></div><div className="initial-schedule-header-actions"><button type="button" className="scheduler-button" onClick={() => createSchedule()}>라인·일자별 초기 스케줄 생성</button><button type="button" className="modal-close-button" aria-label="팝업 닫기" onClick={() => setIsInitialScheduleModalOpen(false)}>×</button></div></div><label className="planning-mode-picker">계획 방식<select value={planningMode} onChange={(event) => setPlanningMode(event.target.value)}><option value="판매 목표 우선">판매 목표 우선 · 부족은 경고로 표시</option><option value="원료 제약 반영">원료 제약 반영 · 재고가 없으면 생산 중단</option></select></label><div className="table-wrap initial-schedule-table"><table><thead><tr><th rowSpan={2}>일자</th><th rowSpan={2}>요일</th>{initialScheduleLines.map((line) => <th colSpan={2} key={line.code} className="plant-header">{line.name}</th>)}</tr><tr>{initialScheduleLines.flatMap((line) => [<th key={`${line.code}-status`}>가동여부</th>, <th key={`${line.code}-downtime`}>휴지시간</th>])}</tr></thead><tbody>{planningRangeDates.map((day) => { const weekday = new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={day}><td>{day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{weekday}</td>{initialScheduleLines.flatMap((line) => { const key = `${day}__${line.code}`; const condition = initialScheduleConditions[key] ?? { operation_status: "가동", downtime_hours: 0 }; const update = (changes: Partial<typeof condition>) => setInitialScheduleConditions((rows) => ({ ...rows, [key]: { ...condition, ...changes } })); return [<td key={`${key}-status`}><select className="cell-select" value={condition.operation_status} onChange={(event) => update({ operation_status: event.target.value })}><option value="가동">가동</option><option value="휴지">휴지</option><option value="중수리">중수리</option><option value="대수리">대수리</option><option value="정전">정전</option></select></td>, <td key={`${key}-downtime`}><input className="cell-input" type="number" min="0" max="24" step="0.1" value={condition.downtime_hours} onChange={(event) => update({ downtime_hours: Math.min(24, Math.max(0, Number(event.target.value))) })}/></td>]; })}</tr>; })}</tbody></table></div></section></div>}
      {(view === "planning" || view === "schedule" || view === "monthly" || view === "daily" || view === "production-monthly" || view === "production-daily") && <section className="card planning-card">
        {scheduleMeta && <div className="version-bar"><strong>V{scheduleMeta.version} · {scheduleMeta.status === "검토 중" ? "저장" : scheduleMeta.status}</strong><span>{scheduleMeta.change_reason}</span>{scheduleRunId && <button type="button" className="schedule-export-button" onClick={downloadScheduleExcel} disabled={scheduleMeta.status !== "확정"} title={scheduleMeta.status !== "확정" ? "확정된 생산계획 버전만 다운로드할 수 있습니다." : "판매계획·생산계획·제원치·제품재고·원료재고를 Excel로 다운로드합니다."}>{scheduleMeta.status === "확정" ? "확정본 전체 Excel 다운로드" : "확정 후 Excel 다운로드"}</button>}</div>}
        {scheduleShortages.length > 0 && <div className="table-wrap"><h3>제품별 배정 결과</h3><table><thead><tr><th>제품</th><th>필요 생산량(t)</th><th>배정량(t)</th><th>미배정량(t)</th></tr></thead><tbody>{scheduleShortages.map((item) => <tr key={item.id}><td>{item.product_code}</td><td>{item.required_quantity_ton.toFixed(2)}</td><td>{item.scheduled_quantity_ton.toFixed(2)}</td><td>{item.unallocated_quantity_ton.toFixed(2)}</td></tr>)}</tbody></table></div>}
        {scheduleItems.length > 0 && <div className="table-wrap"><h3>일자·라인별 생산 스케줄 조정</h3><p>일자·제품·생산량을 수정한 뒤 저장하세요. 고정하면 확정 대상으로 표시되며, 변경 사유도 함께 남길 수 있습니다.</p><table><thead><tr><th>일자</th><th>공장</th><th>라인</th><th>제품</th><th>생산계획(t)</th><th>가용능력(t)</th><th>정비</th><th>전환</th><th>고정</th><th>변경 사유</th><th>저장</th></tr></thead><tbody>{scheduleItems.map((item) => <tr key={item.id} className={item.is_locked ? "locked-row" : ""}><td><input className="table-input" type="date" value={item.planned_date} onChange={(event) => changeScheduleItem(item.id, { planned_date: event.target.value })} /></td><td>{item.plant_name}</td><td>{item.line_name}</td><td><input className="table-input product-input" value={item.product_code} onChange={(event) => changeScheduleItem(item.id, { product_code: event.target.value.toUpperCase() })} /></td><td><input className="table-input quantity-input" type="number" min="0.01" step="0.01" value={item.planned_quantity_ton} onChange={(event) => changeScheduleItem(item.id, { planned_quantity_ton: Number(event.target.value) })} /></td><td>{item.available_capacity_ton.toFixed(2)}</td><td>{item.downtime_hours.toFixed(1)}h</td><td>{item.changeover_hours.toFixed(1)}h</td><td><input type="checkbox" checked={item.is_locked} onChange={(event) => changeScheduleItem(item.id, { is_locked: event.target.checked })} /></td><td><input className="table-input note-input" value={item.adjustment_note} placeholder="예: 고객 요청" onChange={(event) => changeScheduleItem(item.id, { adjustment_note: event.target.value })} /></td><td><button type="button" className="small-button" onClick={() => saveScheduleItem(item)}>저장</button></td></tr>)}</tbody></table></div>}
        {scheduleItems.length > 0 && <section className="dashboard"><h3>스케줄 요약</h3><div className="metrics"><div><span>계획 생산량</span><strong>{scheduleItems.reduce((sum, item) => sum + item.planned_quantity_ton, 0).toFixed(1)} t</strong></div><div><span>CAPA 사용률</span><strong>{((scheduleItems.reduce((sum, item) => sum + item.planned_quantity_ton, 0) / Math.max(scheduleItems.reduce((sum, item) => sum + item.available_capacity_ton, 0), 1)) * 100).toFixed(1)}%</strong></div><div><span>사용 라인</span><strong>{new Set(scheduleItems.map((item) => item.line_code)).size} 개</strong></div><div><span>미배정 생산량</span><strong>{scheduleShortages.reduce((sum, item) => sum + item.unallocated_quantity_ton, 0).toFixed(1)} t</strong></div></div><div className="product-bars">{scheduleShortages.map((item) => <div key={item.id}><span>{item.product_code}</span><div><i style={{ width: `${Math.min(100, item.required_quantity_ton ? item.scheduled_quantity_ton / item.required_quantity_ton * 100 : 0)}%` }} /></div><em>{item.scheduled_quantity_ton.toFixed(1)} / {item.required_quantity_ton.toFixed(1)} t</em></div>)}</div></section>}
        {scheduleRunId && <button className="validation-button" onClick={validateRawMaterials}>BOM·원료재고·입고계획 검증</button>}
        {rawMaterialBalances.length > 0 && <div className="table-wrap"><h3>원료 가용성 검증 결과</h3><p>입고량을 먼저 더하고, 당일 생산에 필요한 BOM 원료를 차감합니다. 부족량이 0보다 크면 해당 날짜에 원료가 부족합니다.</p><table><thead><tr><th>일자</th><th>공장</th><th>원료</th><th>기초 재고(t)</th><th>입고(t)</th><th>BOM 소요량(t)</th><th>기말 재고(t)</th><th>부족량(t)</th></tr></thead><tbody>{rawMaterialBalances.map((item) => <tr className={item.shortage_quantity_ton > 0 ? "shortage-row" : ""} key={item.id}><td>{item.balance_date}</td><td>{item.plant_name}</td><td>{item.material_code}</td><td>{item.opening_quantity_ton.toFixed(2)}</td><td>{item.inbound_quantity_ton.toFixed(2)}</td><td>{item.required_quantity_ton.toFixed(2)}</td><td>{item.ending_quantity_ton.toFixed(2)}</td><td><strong>{item.shortage_quantity_ton.toFixed(2)}</strong></td></tr>)}</tbody></table></div>}
      </section>}
      {view === "production-monthly" && <section className="card production-monthly-panel"><label className="plant-picker">조회 공장<select value={dailyPlantFilter} onChange={(event) => setDailyPlantFilter(event.target.value)}><option value="all">전체 공장</option>{[...new Set(groupedProductionRows.map((row) => row.plant))].map((plant) => <option key={plant}>{plant}</option>)}</select></label><h2>{planningYear}년 {planningMonth}월 생산계획</h2><div className="table-wrap reference-table"><table><thead><tr><th>공장</th><th>공정</th><th>라인</th><th>반제품코드</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계(t)</th></tr></thead><tbody>{groupedProductionRows.filter((row) => dailyPlantFilter === "all" || row.plant === dailyPlantFilter).map((row) => <tr key={`${row.plant}-${row.process}-${row.line}-${row.product}`}>{row.plantSpan > 0 && <td rowSpan={row.plantSpan}>{row.plant}</td>}{row.processSpan > 0 && <td rowSpan={row.processSpan}>{row.process}</td>}{row.lineSpan > 0 && <td rowSpan={row.lineSpan}>{row.line}</td>}<td>{row.product}</td>{planPeriods.map((period) => <td key={period}>{row.values[period] ? row.values[period].toFixed(1) : "-"}</td>)}<td className="total-cell">{Object.values(row.values).reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>)}{!groupedProductionRows.length && <tr><td colSpan={8}>생성된 생산계획이 없습니다.</td></tr>}</tbody></table></div><h2>월별 제품입고량 (P 공정)</h2><div className="table-wrap reference-table"><table><thead><tr><th>반제품코드</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계(t)</th></tr></thead><tbody>{productInboundRows.map((row) => <tr key={row.product}><td>{row.product}</td>{planPeriods.map((period) => <td key={period}>{row.values[period] ? row.values[period].toFixed(1) : "-"}</td>)}<td className="total-cell">{Object.values(row.values).reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>)}{!productInboundRows.length && <tr><td colSpan={5}>P 공정에서 생성된 제품 입고량이 없습니다.</td></tr>}</tbody></table></div></section>}
      {view === "raw-inventory" && <section className="card raw-inventory-panel">
        <div className="daily-filters"><label>공장<select value={dailyPlantFilter} onChange={(event) => { setDailyPlantFilter(event.target.value); setDailyProcessFilter("all"); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.map((line) => line.plant_name))].map((plant) => <option key={plant} value={plant}>{plant}</option>)}</select></label><label>공정<select value={dailyProcessFilter} onChange={(event) => { setDailyProcessFilter(event.target.value); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.filter((line) => dailyPlantFilter === "all" || line.plant_name === dailyPlantFilter).map((line) => line.process_code))].map((process) => <option key={process} value={process}>{processLabel(process)}</option>)}</select></label><label>라인<select value={dailyLineFilter} onChange={(event) => setDailyLineFilter(event.target.value)}><option value="all">전체</option>{dailyLines.map((line) => <option key={line.code} value={line.line}>{line.line}</option>)}</select></label></div>
        <div className="table-wrap reference-table raw-flow-table"><table><thead><tr><th rowSpan={2}>일자</th><th rowSpan={2}>요일</th>{rawMaterials.map((code) => <th colSpan={3} key={code} className="plant-header">{code}</th>)}</tr><tr>{rawMaterials.flatMap((code) => ["입고", "소요량", "재고"].map((label) => <th key={`${code}-${label}`}>{label}</th>))}</tr></thead><tbody>{rangeDailyDates.map((day) => { const weekday = new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={day}><td>{day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{weekday}</td>{rawMaterials.flatMap((code) => { const inbound = rawInboundItems.filter((item) => item.inbound_date === day && item.material_code === code && (dailyPlantFilter === "all" || item.plant_name === dailyPlantFilter)).reduce((sum, item) => sum + item.quantity_ton, 0); const balances = rawMaterialBalances.filter((item) => item.balance_date === day && item.material_code === code && (dailyPlantFilter === "all" || item.plant_name === dailyPlantFilter)); const usage = balances.reduce((sum, item) => sum + item.required_quantity_ton, 0); const stock = rawStockByDayMaterial.get(`${day}__${code}`) ?? 0; return [<td key={`${code}-in`}>{inbound ? inbound.toFixed(1) : "-"}</td>, <td key={`${code}-use`}>{usage ? usage.toFixed(1) : "-"}</td>, <td key={`${code}-stock`} className={stock < 0 ? "negative-stock" : ""}>{stock.toFixed(1)}</td>]; })}</tr>; })}</tbody></table></div>
      </section>}
      {view === "product-inventory" && <section className="card product-inventory-range-panel">
        <h2>제품재고</h2><p>제품별로 Master에 등록된 공정과 제품 입고 흐름을 생산·소비·재고로 표시합니다.</p>
        <div className="table-wrap reference-table product-process-flow"><table><thead>
          <tr><th rowSpan={3}>일자</th><th rowSpan={3}>요일</th>{productInventoryGroups.map((group) => <th colSpan={group.processes.length * 3} key={group.code} className="plant-header">{group.code}</th>)}</tr>
          <tr>{productInventoryGroups.flatMap((group) => group.processes.map((process) => <th colSpan={3} key={`${group.code}-${process}`}>{process === "INBOUND" ? "입고" : processLabel(process)}</th>))}</tr>
          <tr>{productInventoryGroups.flatMap((group) => group.processes.flatMap((process) => (process === "INBOUND" ? ["입고", "판매량", "재고"] : ["생산", "소비", "재고"]).map((label) => <th key={`${group.code}-${process}-${label}`}>{label}</th>)))}</tr>
        </thead><tbody>{productInventoryFlowRows.map((row) => { const weekday = new Date(`${row.day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={row.day}><td>{row.day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{weekday}</td>{row.products.flatMap((product) => product.processes.flatMap((process) => [<td key={`${product.code}-${process.process}-production`}>{process.production ? process.production.toFixed(1) : "-"}</td>, <td key={`${product.code}-${process.process}-consumption`}>{process.consumption ? process.consumption.toFixed(1) : "-"}</td>, <td key={`${product.code}-${process.process}-stock`} className={process.stock < 0 ? "negative-stock" : ""}>{process.stock ? process.stock.toFixed(1) : "-"}</td>]))}</tr>; })}</tbody></table></div>
      </section>}
      {(view === "spec-monthly" || view === "spec-daily") && <section className="card spec-reference-panel"><div className="spec-layout"><aside><strong>공장 · 라인</strong>{[...new Set(lineSpecifications.map((line) => line.plant_name))].map((plant) => <label key={plant}>◉ {plant}</label>)}<hr/><label>◉ 전체 라인</label>{lineSpecifications.map((line) => <label key={line.code}>◯ {line.name}</label>)}</aside><div><h2>{dailyPlantFilter === "all" ? "전체 공장 · 전체 라인" : dailyPlantFilter}</h2><div className="reference-tabs"><button>초안</button><button disabled>변경</button><button disabled>비교</button></div>{view === "spec-monthly" ? <div className="table-wrap reference-table"><table><thead><tr><th>구분</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계</th></tr></thead><tbody>{dailyLines.map((line) => <><tr key={`${line.line}-title`}><th colSpan={5} className="section-row">{line.plant} · {line.line} · {line.process}</th></tr>{["역시간", "휴지시간", "작업가능시간", "순작업시간", "가동률", "작업률"].map((metric) => { const values = planPeriods.map((period) => { const days = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate(); const rows = scheduleItems.filter((item) => item.plant_name === line.plant && item.line_name === line.line && item.planned_date.startsWith(period)); const downtime = rows.reduce((sum, item) => sum + item.downtime_hours, 0); const available = days * 24; const operation = rows.reduce((sum, item) => sum + item.planned_quantity_ton, 0) / Math.max(rows.reduce((sum, item) => sum + item.available_capacity_ton, 0), 1) * 100; return metric === "역시간" ? available : metric === "휴지시간" ? downtime : metric === "작업가능시간" ? available - downtime : metric === "순작업시간" ? available - downtime : metric === "가동률" ? operation : (lineSpecifications.find((item) => item.name === line.line)?.operating_efficiency ?? 0) * 100; }); return <tr key={`${line.line}-${metric}`}><th>{metric}</th>{values.map((value, index) => <td key={index}>{metric.includes("률") ? `${value.toFixed(1)}%` : value.toFixed(1)}</td>)}<td className="total-cell">{metric.includes("률") ? `${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}%` : values.reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>; })}</>)}</tbody></table></div> : <div className="table-wrap reference-table"><table><thead><tr><th rowSpan={2}>일자</th><th rowSpan={2}>요일</th>{dailyLines.map((line) => <th colSpan={6} key={line.line} className="plant-header">{line.plant} · {line.line}</th>)}</tr><tr>{dailyLines.flatMap((line) => ["역시간", "휴지시간", "작업가능시간", "순작업시간", "가동률", "작업률"].map((label) => <th key={`${line.line}-${label}`}>{label}</th>))}</tr></thead><tbody>{dailyDates.map((day) => { const weekday = new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={day}><td>{day.slice(2).replaceAll("-", ".")}</td><td>{weekday}</td>{dailyLines.map((line) => { const item = scheduleByDateLine.get(`${day}__${line.plant}__${line.line}`); const net = item ? 24 - item.downtime_hours : 24; const rate = item ? item.planned_quantity_ton / Math.max(item.available_capacity_ton, 1) * 100 : 0; const efficiency = (lineSpecifications.find((spec) => spec.name === line.line)?.operating_efficiency ?? 0) * 100; return <><td key={`${line.line}-a`}>24</td><td key={`${line.line}-b`}>{item?.downtime_hours.toFixed(1) ?? "-"}</td><td key={`${line.line}-c`}>{net.toFixed(1)}</td><td key={`${line.line}-d`}>{net.toFixed(1)}</td><td key={`${line.line}-e`}>{rate.toFixed(1)}%</td><td key={`${line.line}-f`}>{efficiency.toFixed(1)}%</td></>; })}</tr>; })}</tbody></table></div>}</div></div></section>}
      {view === "product-inventory" && <section className="card product-inventory-panel"><h2>제품재고</h2><div className="reference-tabs"><button>초안</button><button disabled>변경</button></div><div className="inventory-layout"><aside><strong>전체 제품재고</strong>{[...new Set(productInventory.map((item) => item.product_code))].map((code) => <label key={code}>◯ {code}</label>)}</aside><div className="table-wrap reference-table"><table><thead><tr><th rowSpan={3}>일자</th><th rowSpan={3}>요일</th>{[...new Set(productInventory.map((item) => item.product_code))].map((code) => <th colSpan={5} key={code} className="plant-header">{code}</th>)}</tr><tr>{[...new Set(productInventory.map((item) => item.product_code))].map((code) => <th colSpan={3} key={`${code}-prod`}>소성</th>)}{[...new Set(productInventory.map((item) => item.product_code))].map((code) => <th colSpan={2} key={`${code}-in`}>입고</th>)}</tr><tr>{[...new Set(productInventory.map((item) => item.product_code))].flatMap((code) => ["생산", "소비", "재고", "입고", "판매량"].map((label) => <th key={`${code}-${label}`}>{label}</th>))}</tr></thead><tbody>{[...new Set([...scheduleItems.map((item) => item.planned_date), ...productInventory.map((item) => item.snapshot_date)])].sort().map((day) => { const weekday = new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={day}><td>{day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{weekday}</td>{[...new Set(productInventory.map((item) => item.product_code))].flatMap((code) => { const scheduled = scheduleItems.filter((item) => item.planned_date === day && item.product_code === code).reduce((sum, item) => sum + item.planned_quantity_ton, 0); const inventory = productInventory.filter((item) => item.snapshot_date === day && item.product_code === code).reduce((sum, item) => sum + item.quantity_ton, 0); return [<td key={`${code}-make`}>{scheduled ? scheduled.toFixed(1) : "-"}</td>, <td key={`${code}-use`}>-</td>, <td key={`${code}-stock`}>{inventory ? inventory.toFixed(1) : "-"}</td>, <td key={`${code}-in`}>-</td>, <td key={`${code}-sales`}>-</td>]; })}</tr>; })}</tbody></table></div></div></section>}
      {view === "sales-monthly" && <section className="card reference-panel"><h2>판매계획 · 월별 계획</h2><div className="table-wrap reference-table"><table><thead><tr><th>고객사</th><th>제품</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계(t)</th></tr></thead><tbody>{salesTableRows.map((row) => <tr key={`${row.customer}-${row.product}`}><td>{row.customer}</td><td>{row.product}</td>{planPeriods.map((period) => <td key={period}>{row.values[period] ? row.values[period].toFixed(1) : "-"}</td>)}<td className="total-cell">{Object.values(row.values).reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>)}{!salesTableRows.length && <tr><td colSpan={6}>등록된 판매계획이 없습니다.</td></tr>}</tbody></table></div></section>}
      {view === "sales-daily" && <section className="card reference-panel"><h2>판매계획 · 일별 계획</h2><p>토요일·일요일·대한민국 공휴일을 제외한 영업일에만 월 판매계획을 균등 배분하며, 휴일은 -로 표시합니다.</p><div className="table-wrap reference-table"><table><thead><tr><th rowSpan={2}>일자</th><th rowSpan={2}>요일</th>{salesDailyRows[0]?.products.map((item) => <th key={item.product}>{item.product}</th>)}</tr><tr>{salesDailyRows[0]?.products.map((item) => <th key={`${item.product}-customer`}>{item.customer}</th>)}</tr></thead><tbody>{salesDailyRows.map((row, index) => { const weekday = new Date(`${row.day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={`${row.day}-${index}`} className={row.isTotal ? "monthly-total-row" : ""}><td>{row.isTotal ? `${row.day.slice(0, 7)} 합계` : row.day.slice(2).replaceAll("-", ".")}</td><td className={row.isTotal ? "" : weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{row.isTotal ? "" : weekday}</td>{row.products.map((item) => <td key={item.product}>{!row.isTotal && row.isNonWorking ? "-" : item.daily.toFixed(2)}</td>)}</tr>; })}</tbody></table></div></section>}
      {view === "production-monthly" && <section className="card reference-panel"><label className="plant-picker">조회 공장<select value={dailyPlantFilter} onChange={(event) => setDailyPlantFilter(event.target.value)}><option value="all">전체 공장</option>{[...new Set(scheduleItems.map((item) => item.plant_name))].map((plant) => <option key={plant}>{plant}</option>)}</select></label><h2>{planningYear}년 {planningMonth}월 생산계획</h2><div className="table-wrap reference-table"><table><thead><tr><th>공장</th><th>공정</th><th>라인</th><th>반제품코드</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계(t)</th></tr></thead><tbody>{productionMonthlyRows.filter((row) => dailyPlantFilter === "all" || row.plant === dailyPlantFilter).map((row) => <tr key={`${row.plant}-${row.line}-${row.product}`}><td>{row.plant}</td><td>{row.process}</td><td>{row.line}</td><td>{row.product}</td>{planPeriods.map((period) => <td key={period}>{row.values[period] ? row.values[period].toFixed(1) : "-"}</td>)}<td className="total-cell">{Object.values(row.values).reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>)}</tbody></table></div><h2>월별 제품입고량</h2><div className="table-wrap reference-table"><table><thead><tr><th>반제품코드</th>{planPeriods.map((period) => <th key={period}>{period}</th>)}<th>구간 합계(t)</th></tr></thead><tbody>{Object.values(rawInboundItems.reduce<Record<string, { code: string; values: Record<string, number> }>>((all, item) => { const period = item.inbound_date.slice(0, 7); const row = all[item.material_code] ?? { code: item.material_code, values: {} }; row.values[period] = (row.values[period] ?? 0) + item.quantity_ton; all[item.material_code] = row; return all; }, {})).filter((row) => planPeriods.some((period) => row.values[period])).map((row) => <tr key={row.code}><td>{row.code}</td>{planPeriods.map((period) => <td key={period}>{row.values[period] ? row.values[period].toFixed(1) : "-"}</td>)}<td className="total-cell">{Object.values(row.values).reduce((sum, value) => sum + value, 0).toFixed(1)}</td></tr>)}</tbody></table></div></section>}
      {view === "production-daily" && <section className="card schedule-editor-card">
        <div className="schedule-editor-header"><div><h2>생산계획 편집</h2><p>현재 버전: <strong>V{scheduleMeta?.version ?? "-"} · {scheduleMeta?.status ?? "작성 중"}</strong></p></div><div className="schedule-editor-actions"><input value={scheduleChangeReason} onChange={(event) => setScheduleChangeReason(event.target.value)} placeholder="새 버전 생성 사유"/>{scheduleMeta?.status !== "확정" && <><button type="button" onClick={saveAllScheduleItems}>전체 저장</button><button type="button" onClick={() => setScheduleStatus("확정")}>확정</button></>}<button type="button" onClick={copyScheduleVersion}>새 버전 복사</button></div></div>
        <p className="muted">상태·휴지시간·작업률·반제품코드만 수정할 수 있습니다. 입력값에서 포커스를 이동하면 생산량과 품질검사 완료 입고량이 자동으로 다시 계산됩니다.</p>
        <details className="change-history-panel"><summary>계획 변경 이력 ({scheduleChangeHistory.length}건)</summary><div className="table-wrap"><table><thead><tr><th>변경 시각</th><th>변경자</th><th>일자</th><th>라인</th><th>변경 전</th><th>변경 후</th><th>사유</th></tr></thead><tbody>{scheduleChangeHistory.map((history) => <tr key={history.id}><td>{new Date(history.changed_at).toLocaleString("ko-KR")}</td><td>{history.changed_by}</td><td>{history.after_values.planned_date}</td><td>{history.after_values.line_name}</td><td>{history.before_values.product_code} · {history.before_values.planned_quantity_ton.toFixed(2)}</td><td>{history.after_values.product_code} · {history.after_values.planned_quantity_ton.toFixed(2)}</td><td>{history.change_reason || "-"}</td></tr>)}{!scheduleChangeHistory.length && <tr><td colSpan={7}>저장된 변경 이력이 없습니다.</td></tr>}</tbody></table></div></details>
        {scheduleMeta?.status === "확정" && <p className="success">확정된 계획은 수정할 수 없습니다. 변경이 필요하면 새 버전 복사를 사용하세요.</p>}
        {dailyLines.length === 0 ? <p className="muted">선택한 조건에 해당하는 생산라인이 없습니다.</p> : <div className="table-wrap daily-grid schedule-editor-table"><table><thead><tr><th rowSpan={3}>일자</th><th rowSpan={3}>요일</th>{dailyLines.map((line) => <th colSpan={8} key={`${line.code}-editor`} className="plant-header">{line.line}</th>)}</tr><tr>{dailyLines.flatMap((line) => [<th colSpan={2} key={`${line.code}-equipment`}>설비가동계획</th>, <th colSpan={2} key={`${line.code}-condition`}>작업조건</th>, <th colSpan={2} key={`${line.code}-production`}>{processLabel(line.process)}</th>, <th colSpan={2} key={`${line.code}-inbound`}>입고</th>])}</tr><tr>{dailyLines.flatMap((line) => ["상태", "휴지시간", "작업률", "수율", "반제품코드", "생산량", "반제품코드", "입고량"].map((label) => <th key={`${line.code}-${label}`}>{label}</th>))}</tr></thead><tbody>{productionDailyRows.map((row) => { const weekday = new Date(`${row.day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); const locked = scheduleMeta?.status === "확정"; return <tr key={`${row.day}-editor-${row.isTotal ? "total" : "daily"}`} className={row.isTotal ? "monthly-total-row" : ""}><td>{row.isTotal ? `${row.day.slice(2, 7).replace("-", ".")} 합계` : row.day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{row.isTotal ? "" : weekday}</td>{dailyLines.map((line) => { if ("values" in row) { const total = row.values.get(`${line.plant}__${line.line}`); return <><td>-</td><td>{total?.downtime ? total.downtime.toFixed(1) : "-"}</td><td>-</td><td>-</td><td>-</td><td>{total?.production ? total.production.toFixed(2) : "-"}</td><td>-</td><td>{total?.inbound ? total.inbound.toFixed(2) : "-"}</td></>; } const item = scheduleByDateLine.get(`${row.day}__${line.plant}__${line.line}`); const inbound = qualityInboundByDateLine.get(`${row.day}__${line.plant}__${line.line}`); if (!item) { const key = `${row.day}__${line.code}`; const draft = draftScheduleCells[key] ?? { product_code: "", downtime_hours: 0, work_rate: 100, operation_status: "가동" }; const updateDraft = (changes: Partial<typeof draft>) => setDraftScheduleCells((cells) => ({ ...cells, [key]: { ...draft, ...changes } })); return <><td><select className="cell-select" disabled={locked} value={draft.operation_status} onChange={(event) => updateDraft({ operation_status: event.target.value })}><option value="가동">가동</option><option value="휴지">휴지</option></select></td><td><input className="cell-input" type="number" min="0" max="24" step="0.1" disabled={locked || draft.operation_status === "휴지"} value={draft.downtime_hours} onChange={(event) => updateDraft({ downtime_hours: Number(event.target.value) })}/></td><td><input className="cell-input" type="number" min="0" max="100" step="1" disabled={locked} value={draft.work_rate} onChange={(event) => updateDraft({ work_rate: Number(event.target.value) })}/></td><td>-</td><td><input className="cell-input product-input" disabled={locked} placeholder="반제품코드" value={draft.product_code} onChange={(event) => updateDraft({ product_code: event.target.value.toUpperCase() })} onBlur={() => createScheduleItem(row.day, line, draft)}/></td><td>-</td><td>-</td><td>-</td></>; } return <><td><select className="cell-select" disabled={locked} value={item.operation_status} onChange={(event) => { changeScheduleItem(item.id, { operation_status: event.target.value }); }} onBlur={() => recalculateScheduleItem(item.id)}><option value="가동">가동</option><option value="휴지">휴지</option></select></td><td><input className="cell-input" type="number" min="0" max="24" step="0.1" disabled={locked || item.operation_status === "휴지"} value={item.downtime_hours} onChange={(event) => changeScheduleItem(item.id, { downtime_hours: Number(event.target.value) })} onBlur={() => recalculateScheduleItem(item.id)}/></td><td><input className="cell-input" type="number" min="0" max="100" step="1" disabled={locked} value={(item.work_rate * 100).toFixed(0)} onChange={(event) => changeScheduleItem(item.id, { work_rate: Number(event.target.value) / 100 })} onBlur={() => recalculateScheduleItem(item.id)}/></td><td>{`${(itemYield(item, line.process) * 100).toFixed(1)}%`}</td><td><input className="cell-input product-input" disabled={locked} value={item.product_code} onChange={(event) => changeScheduleItem(item.id, { product_code: event.target.value.toUpperCase() })} onBlur={() => recalculateScheduleItem(item.id)}/></td><td>{item.planned_quantity_ton.toFixed(2)}</td><td>{inbound?.codes.join(", ") ?? "-"}</td><td>{inbound ? inbound.quantity_ton.toFixed(2) : "-"}</td></>; })}</tr>; })}</tbody></table></div>}
      </section>}
      {view === "production-daily" && <section className="card daily-plan-requested">
        <h2>일별 생산계획</h2>
        <div className="daily-filters">
          <label>공장<select value={dailyPlantFilter} onChange={(event) => { setDailyPlantFilter(event.target.value); setDailyProcessFilter("all"); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.map((line) => line.plant_name))].map((plant) => <option key={plant} value={plant}>{plant}</option>)}</select></label>
          <label>공정<select value={dailyProcessFilter} onChange={(event) => { setDailyProcessFilter(event.target.value); setDailyLineFilter("all"); }}><option value="all">전체</option>{[...new Set(lineSpecifications.filter((line) => dailyPlantFilter === "all" || line.plant_name === dailyPlantFilter).map((line) => line.process_code))].map((process) => <option key={process} value={process}>{process === "H" ? "소성" : process === "S" ? "S처리" : process === "R" ? "재구형화" : process}</option>)}</select></label>
          <label>라인<select value={dailyLineFilter} onChange={(event) => setDailyLineFilter(event.target.value)}><option value="all">전체</option>{dailyLines.map((line) => <option key={`${line.plant}-${line.line}`} value={line.line}>{line.line}</option>)}</select></label>
        </div>
        {dailyLines.length === 0 ? <p className="muted">선택한 조건에 해당하는 생산라인이 없습니다.</p> : <div className="table-wrap daily-grid requested-grid"><table><thead><tr><th rowSpan={3}>일자</th><th rowSpan={3}>요일</th>{dailyLines.map((line) => <th colSpan={8} key={`${line.plant}-${line.process}-${line.line}`} className="plant-header">{line.line}</th>)}</tr><tr>{dailyLines.flatMap((line) => [<th colSpan={2} key={`${line.line}-equipment`}>설비가동계획</th>, <th colSpan={2} key={`${line.line}-condition`}>작업조건</th>, <th colSpan={2} key={`${line.line}-production`}>{processLabel(line.process)}</th>, <th colSpan={2} key={`${line.line}-inbound`}>입고</th>])}</tr><tr>{dailyLines.flatMap((line) => ["상태", "휴지시간", "작업률", "수율", "반제품코드", "생산량", "반제품코드", "입고량"].map((label) => <th key={`${line.plant}-${line.process}-${line.line}-${label}`}>{label}</th>))}</tr></thead><tbody>{productionDailyRows.map((row) => { const weekday = new Date(`${row.day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={`${row.day}-${row.isTotal ? "total" : "daily"}`} className={row.isTotal ? "monthly-total-row" : ""}><td>{row.isTotal ? `${row.day.slice(2, 7).replace("-", ".")} 합계` : row.day.slice(2).replaceAll("-", ".")}</td><td className={row.isTotal ? "" : weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{row.isTotal ? "" : weekday}</td>{dailyLines.map((line) => { if ("values" in row) { const total = row.values.get(`${line.plant}__${line.line}`); return <><td key={`${line.line}-status`}>-</td><td key={`${line.line}-down`}>{total?.downtime ? total.downtime.toFixed(1) : "-"}</td><td key={`${line.line}-rate`}>-</td><td key={`${line.line}-yield`}>-</td><td key={`${line.line}-product`}>-</td><td key={`${line.line}-production-qty`}>{total?.production ? total.production.toFixed(2) : "-"}</td><td key={`${line.line}-inbound-code`}>-</td><td key={`${line.line}-inbound-qty`}>{total?.inbound ? total.inbound.toFixed(2) : "-"}</td></>; } const item = scheduleByDateLine.get(`${row.day}__${line.plant}__${line.line}`); const inbound = qualityInboundByDateLine.get(`${row.day}__${line.plant}__${line.line}`); return <><td key={`${line.line}-status`}>{item?.operation_status ?? "-"}</td><td key={`${line.line}-down`}>{item ? item.downtime_hours.toFixed(1) : "-"}</td><td key={`${line.line}-rate`}>{item ? `${(item.work_rate * 100).toFixed(0)}%` : "-"}</td><td key={`${line.line}-yield`}>{item ? `${(itemYield(item, line.process) * 100).toFixed(1)}%` : "-"}</td><td key={`${line.line}-product`}>{item?.product_code ?? "-"}</td><td key={`${line.line}-production-qty`}>{item ? item.planned_quantity_ton.toFixed(2) : "-"}</td><td key={`${line.line}-inbound-code`}>{inbound?.codes.join(", ") ?? "-"}</td><td key={`${line.line}-inbound-qty`}>{inbound ? inbound.quantity_ton.toFixed(2) : "-"}</td></>; })}</tr>; })}</tbody></table></div>}
      </section>}
      {view === "production-daily" && <section className="card daily-plan-card"><h2>일별 생산계획</h2><p>날짜별로 각 공장·라인의 설비 가동계획, 작업조건과 생산량을 한 화면에서 확인합니다.</p>{scheduleItems.length === 0 ? <p className="muted">생성된 생산 스케줄이 없습니다. 생산계획 월별 화면에서 초기 스케줄을 먼저 생성해 주세요.</p> : <div className="table-wrap daily-grid"><table><thead><tr><th rowSpan={2}>일자</th><th rowSpan={2}>요일</th>{dailyLines.map((line) => <th colSpan={6} key={`${line.plant}-${line.line}`} className="plant-header">{line.plant} · {line.line}</th>)}</tr><tr>{dailyLines.flatMap((line) => ["상태", "휴지 시간", "작업률(%)", "수율(%)", "제품", "생산량(t)"].map((label) => <th key={`${line.plant}-${line.line}-${label}`}>{label}</th>))}</tr></thead><tbody>{dailyDates.map((day) => { const weekday = new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", { weekday: "short" }); return <tr key={day}><td>{day.slice(2).replaceAll("-", ".")}</td><td className={weekday === "토" ? "saturday" : weekday === "일" ? "sunday" : ""}>{weekday}</td>{dailyLines.map((line) => { const item = scheduleByDateLine.get(`${day}__${line.plant}__${line.line}`); const rate = item ? Math.min(100, item.planned_quantity_ton / Math.max(item.available_capacity_ton, 0.01) * 100) : 0; return item ? <><td key={`${line.plant}-${line.line}-state`}>{item.downtime_hours > 0 ? "정비 포함" : "가동"}</td><td key={`${line.plant}-${line.line}-down`}>{item.downtime_hours.toFixed(1)}</td><td key={`${line.plant}-${line.line}-rate`}>{rate.toFixed(0)}%</td><td key={`${line.plant}-${line.line}-yield`}>100%</td><td key={`${line.plant}-${line.line}-product`}>{item.product_code}</td><td key={`${line.plant}-${line.line}-qty`}>{item.planned_quantity_ton.toFixed(2)}</td></> : <>{Array.from({ length: 6 }, (_, index) => <td key={`${line.plant}-${line.line}-empty-${index}`}>-</td>)}</>; })}</tr>; })}</tbody></table></div>}</section>}
      {view === "data-upload" && <section className="card actual-upload-card"><h2>생산실적 Excel 등록</h2><p>헤더: <code>일자, 공장, 라인, 제품, 생산량</code> (톤)</p><form onSubmit={importActuals} className="upload-form"><input name="actualFile" type="file" accept=".xlsx" required/><button type="submit">생산실적 등록</button></form>{actualImport&&<p className="success">{actualImport.file_name} 등록 완료: 실적 {actualImport.item_count}건</p>}</section>}
      {view === "data-upload" && <section className="card data-status-card"><h2>현재 적용 데이터</h2><p>이전 업로드 이력을 선택해 현재 적용 파일을 변경하거나 삭제할 수 있습니다. 삭제하면 해당 파일에서 적재한 상세 데이터도 함께 삭제됩니다.</p><div className="table-wrap"><table><thead><tr><th>데이터</th><th>현재 적용 파일</th><th>등록 시각</th><th>적재 건수</th><th>이력 관리</th></tr></thead><tbody>{dataStatuses.map((status) => { const selectedId = selectedImports[status.name] ?? status.latest?.id; return <tr key={status.name}><td>{status.name}</td><td>{status.latest?.file_name ?? "미등록"}</td><td>{status.latest ? new Date(status.latest.imported_at).toLocaleString("ko-KR") : "-"}</td><td>{status.latest?.item_count ?? "-"}</td><td>{status.history.length>0&&<><select value={selectedId} onChange={(e)=>setSelectedImports({...selectedImports,[status.name]:Number(e.target.value)})}>{status.history.map((row)=><option key={row.id} value={row.id}>{row.file_name}</option>)}</select><button type="button" className="small-button" onClick={()=>activateImport(status.name,selectedId!)}>적용</button><button type="button" className="delete-button history-delete-button" onClick={()=>deleteImport(status,selectedId!)}>삭제</button></>}</td></tr>; })}</tbody></table></div></section>}
      {view === "data-compare" && <section className="card sales-comparison-card">
        <h2>판매계획 업로드본 비교</h2>
        {salesImports.length < 2 ? <p className="muted">비교하려면 판매계획 파일을 두 번 이상 등록해 주세요.</p> : <>
          <div className="sales-comparison-files">
            <section className="comparison-file-panel base-file-panel"><h3>기준 파일</h3><div className="comparison-file-fields"><label><span>파일명</span><select value={baseSalesImportId ?? ""} onChange={(event) => setBaseSalesImportId(Number(event.target.value))}>{salesImports.map((item) => <option key={item.id} value={item.id}>{item.file_name}</option>)}</select></label><label><span>업로드일</span><output>{salesImports.find((item) => item.id === baseSalesImportId) ? new Date(salesImports.find((item) => item.id === baseSalesImportId)!.imported_at).toLocaleString("ko-KR") : "-"}</output></label></div></section>
            <section className="comparison-file-panel compare-file-panel"><h3>비교 파일</h3><div className="comparison-file-fields"><label><span>파일명</span><select value={compareSalesImportId ?? ""} onChange={(event) => setCompareSalesImportId(Number(event.target.value))}>{salesImports.map((item) => <option key={item.id} value={item.id}>{item.file_name}</option>)}</select></label><label><span>업로드일</span><output>{salesImports.find((item) => item.id === compareSalesImportId) ? new Date(salesImports.find((item) => item.id === compareSalesImportId)!.imported_at).toLocaleString("ko-KR") : "-"}</output></label></div></section>
          </div>
          <button type="button" className="comparison-button" onClick={compareSalesPlans}>비교하기</button>
          {salesComparison && <>
            {salesComparison.items.length ? <div className="table-wrap comparison-table"><table><thead><tr><th>연월</th><th>고객사</th><th>제품</th><th>기준(t)</th><th>비교(t)</th><th>증감(비교-기준)</th><th>증감률</th></tr></thead><tbody>{salesComparisonPeriods.map(({ period, items }) => <Fragment key={period}>{items.map((item, index) => { const isFirstPeriodRow = index === 0; const isFirstCustomerRow = index === 0 || items[index - 1].customer !== item.customer; const customerRowSpan = isFirstCustomerRow ? items.filter((candidate) => candidate.customer === item.customer).length : 0; return <tr key={`${period}-${item.customer}-${item.product_code}`} className={item.difference_ton > 0 ? "increase-row" : "decrease-row"}>{isFirstPeriodRow && <td rowSpan={items.length}>{period}</td>}{isFirstCustomerRow && <td rowSpan={customerRowSpan}>{item.customer}</td>}<td>{item.product_code}</td><td>{item.base_quantity_ton.toLocaleString()}</td><td>{item.compare_quantity_ton.toLocaleString()}</td><td>{item.difference_ton > 0 ? "+" : ""}{item.difference_ton.toLocaleString()}</td><td>{item.difference_rate === null ? "신규" : `${item.difference_rate > 0 ? "+" : ""}${item.difference_rate.toFixed(1)}%`}</td></tr>; })}<tr className="comparison-period-total"><th colSpan={3}>{period} 합계</th><td>{items.reduce((sum, item) => sum + item.base_quantity_ton, 0).toLocaleString()}</td><td>{items.reduce((sum, item) => sum + item.compare_quantity_ton, 0).toLocaleString()}</td><td>{items.reduce((sum, item) => sum + item.difference_ton, 0) > 0 ? "+" : ""}{items.reduce((sum, item) => sum + item.difference_ton, 0).toLocaleString()}</td><td>-</td></tr></Fragment>)}</tbody></table></div> : <p className="success">두 판매계획의 수량 차이가 없습니다.</p>}
          </>}
        </>}
      </section>}
      {view === "data-compare" && <section className="card actual-comparison-card"><h2>생산계획 버전 비교</h2><p>기준 버전과 변경 버전의 월별·공장별·제품별·공정별 생산계획을 비교합니다.</p>{scheduleVersions.length < 2 ? <p className="muted">비교하려면 생산계획 버전이 두 개 이상 필요합니다.</p> : <><div className="sales-comparison-files"><section className="comparison-file-panel base-file-panel"><h3>기준 버전</h3><div className="comparison-file-fields"><label><span>버전</span><select value={baseScheduleVersionId ?? ""} onChange={(event) => setBaseScheduleVersionId(Number(event.target.value))}>{scheduleVersions.map((item) => <option key={item.id} value={item.id}>V{item.version} · {item.status} ({item.planning_year}.{String(item.planning_month).padStart(2, "0")}~{item.planning_end_year}.{String(item.planning_end_month).padStart(2, "0")})</option>)}</select></label><label><span>생성일</span><output>{scheduleVersions.find((item) => item.id === baseScheduleVersionId) ? new Date(scheduleVersions.find((item) => item.id === baseScheduleVersionId)!.created_at).toLocaleString("ko-KR") : "-"}</output></label></div></section><section className="comparison-file-panel compare-file-panel"><h3>변경 버전</h3><div className="comparison-file-fields"><label><span>버전</span><select value={compareScheduleVersionId ?? ""} onChange={(event) => setCompareScheduleVersionId(Number(event.target.value))}>{scheduleVersions.map((item) => <option key={item.id} value={item.id}>V{item.version} · {item.status} ({item.planning_year}.{String(item.planning_month).padStart(2, "0")}~{item.planning_end_year}.{String(item.planning_end_month).padStart(2, "0")})</option>)}</select></label><label><span>생성일</span><output>{scheduleVersions.find((item) => item.id === compareScheduleVersionId) ? new Date(scheduleVersions.find((item) => item.id === compareScheduleVersionId)!.created_at).toLocaleString("ko-KR") : "-"}</output></label></div></section></div><button type="button" className="comparison-button" onClick={compareScheduleVersions}>비교하기</button>{scheduleVersionComparison && <div className="table-wrap comparison-table"><table><thead><tr><th>연월</th><th>공장</th><th>제품</th><th>공정</th><th>기준(t)</th><th>변경(t)</th><th>증감(변경-기준)</th></tr></thead><tbody>{scheduleVersionComparison.items.map((item) => <tr key={`${item.period}-${item.plant_name}-${item.product_code}-${item.process_code}`} className={item.difference_ton > 0 ? "increase-row" : item.difference_ton < 0 ? "decrease-row" : ""}><td>{item.period}</td><td>{item.plant_name}</td><td>{item.product_code}</td><td>{processLabel(item.process_code)}</td><td>{item.base_quantity_ton.toFixed(2)}</td><td>{item.compare_quantity_ton.toFixed(2)}</td><td>{item.difference_ton > 0 ? "+" : ""}{item.difference_ton.toFixed(2)}</td></tr>)}</tbody></table></div>}</>}</section>}
      {(view === "spec-monthly" || view === "spec-daily") && <section className="card specification-card"><h2>공장·라인 제원치</h2><p>가동효율은 스케줄러의 일일 생산가능량 계산에 사용됩니다. 예: 0.98 = 98%</p><div className="table-wrap"><table><thead><tr><th>공장</th><th>라인 코드</th><th>라인명</th><th>공정</th><th>가동효율</th><th>저장</th></tr></thead><tbody>{lineSpecifications.map((line) => <tr key={line.code}><td>{line.plant_name}</td><td>{line.code}</td><td>{line.name}</td><td>{line.process_code}</td><td><input className="table-input" type="number" min="0" max="1.5" step="0.01" value={line.operating_efficiency ?? ""} onChange={(event) => setLineSpecifications((items) => items.map((item) => item.code === line.code ? { ...item, operating_efficiency: Number(event.target.value) } : item))} /></td><td><button className="small-button" onClick={() => saveEfficiency(line)}>저장</button></td></tr>)}{!lineSpecifications.length && <tr><td colSpan={6}>등록된 라인 제원치가 없습니다. Master 파일을 등록해 주세요.</td></tr>}</tbody></table></div></section>}
      <section className="card raw-inbound-card">
        <h2>{view === "raw-inventory-inbound" ? "원료 입고계획" : "원료 입고계획 Excel 등록"}</h2>
        <form onSubmit={(event) => importOperations(event, "raw-inbound")} className="upload-form">
          <input name="raw-inboundFile" type="file" accept=".xlsx" required />
          <button type="submit">원료 입고계획 등록</button>
        </form>
        {rawInboundImport && <p className="success">{rawInboundImport.file_name} 등록 완료: 입고계획 {rawInboundImport.item_count}건</p>}
        {rawInboundItems.length > 0 && <><button type="button" className="preview-toggle" onClick={() => toggleUploadTable("raw-inbound")}>{expandedUploadTables["raw-inbound"] ? "표 접기" : "표 펼치기"}</button>{expandedUploadTables["raw-inbound"] && <div className="table-wrap upload-preview-table"><table><thead><tr><th>입고일</th><th>공장</th><th>원료</th><th>입고량(t)</th></tr></thead><tbody>{rawInboundItems.map((item) => <tr key={item.id}><td>{item.inbound_date}</td><td>{item.plant_name}</td><td>{item.material_code}</td><td>{item.quantity_ton.toFixed(2)}</td></tr>)}</tbody></table></div>}</>}
      </section>
      <section className="card product-inventory-card">
        <h2>{view.startsWith("product-inventory-") ? "제품 재고" : "제품 재고 Excel 등록"}</h2>
        <form onSubmit={(event) => importInventory(event, "product")} className="upload-form">
          <input name="productInventoryFile" type="file" accept=".xlsx" required />
          <button type="submit">제품 재고 등록</button>
        </form>
        {productInventoryImport && <p className="success">{productInventoryImport.file_name} 등록 완료: 재고 스냅샷 {productInventoryImport.item_count}건</p>}
        {productInventory.length > 0 && <p>최신 업로드 기준 {productInventory.length}건을 저장했습니다.</p>}
        {productInventory.length > 0 && <><button type="button" className="preview-toggle" onClick={() => toggleUploadTable("product-inventory")}>{expandedUploadTables["product-inventory"] ? "표 접기" : "표 펼치기"}</button>{expandedUploadTables["product-inventory"] && <div className="table-wrap upload-preview-table"><table><thead><tr><th>기준일</th><th>제품</th><th>공정</th><th>라인</th><th>재고상태</th><th>재고량(t)</th></tr></thead><tbody>{productInventory.map((item) => <tr key={item.id}><td>{item.snapshot_date}</td><td>{item.product_code}</td><td>{item.process_name}</td><td>{item.line_name}</td><td>{item.stock_status}</td><td>{item.quantity_ton.toFixed(2)}</td></tr>)}</tbody></table></div>}</>}
      </section>
      <section className="card raw-inventory-card">
        <h2>{view.startsWith("raw-inventory-") ? "원료 재고" : "원료 재고 Excel 등록"}</h2>
        <form onSubmit={(event) => importInventory(event, "raw")} className="upload-form">
          <input name="rawInventoryFile" type="file" accept=".xlsx" required />
          <button type="submit">원료 재고 등록</button>
        </form>
        {rawInventoryImport && <p className="success">{rawInventoryImport.file_name} 등록 완료: 재고 스냅샷 {rawInventoryImport.item_count}건</p>}
        {rawInventory.length > 0 && <p>최신 업로드 기준 {rawInventory.length}건을 저장했습니다.</p>}
        {rawInventory.length > 0 && <><button type="button" className="preview-toggle" onClick={() => toggleUploadTable("raw-inventory")}>{expandedUploadTables["raw-inventory"] ? "표 접기" : "표 펼치기"}</button>{expandedUploadTables["raw-inventory"] && <div className="table-wrap upload-preview-table"><table><thead><tr><th>기준일</th><th>공장</th><th>원료</th><th>재고량(t)</th></tr></thead><tbody>{rawInventory.map((item) => <tr key={item.id}><td>{item.snapshot_date}</td><td>{item.plant_name}</td><td>{item.material_code}</td><td>{item.quantity_ton.toFixed(2)}</td></tr>)}</tbody></table></div>}</>}
      </section>
      <section className="card sales-card">
        <h2>{view.startsWith("sales-") ? "판매계획" : "판매계획 Excel 등록"}</h2>
        <p><code>Data Dummy_Sales.xlsx</code> 파일을 선택해 업로드하세요.</p>
        <form onSubmit={importSales} className="upload-form sales-upload-form">
          <input ref={salesFileInputRef} name="salesFile" type="file" accept=".xlsx" required onChange={() => setSalesValidation(null)} />
          <button type="button" className="validation-check-button" disabled={isSalesValidating} onClick={validateSalesFile}>{isSalesValidating ? "검증 중..." : "파일 검증"}</button>
          <button type="submit" disabled={isSalesImporting || !salesValidation?.valid}>{isSalesImporting ? "등록 중..." : "판매계획 등록"}</button>
        </form>
        {salesValidation && <section className={`sales-validation-result ${salesValidation.valid ? "valid" : "invalid"}`}><h3>{salesValidation.valid ? "등록 가능한 파일입니다." : `검증 오류 ${salesValidation.error_count}건`}</h3><div><span>검사 행 {salesValidation.parsed_row_count.toLocaleString()}건</span><span>없는 제품코드 {salesValidation.unknown_product_count}건</span><span>중복 행 {salesValidation.duplicate_count}건</span><span>기간 누락 {salesValidation.missing_period_count}건</span></div>{!salesValidation.valid && <><p>오류를 수정한 뒤 다시 검증해 주세요.</p><button type="button" className="validation-report-button" onClick={downloadSalesValidationReport}>오류 행 Excel 다운로드</button><div className="table-wrap validation-error-table"><table><thead><tr><th>오류</th><th>고객사</th><th>제품코드</th><th>연월</th><th>내용</th></tr></thead><tbody>{salesValidation.errors.slice(0, 20).map((error, index) => <tr key={`${error.category}-${error.product_code}-${error.period}-${index}`}><td>{error.category}</td><td>{error.customer || "-"}</td><td>{error.product_code || "-"}</td><td>{error.period || "-"}</td><td>{error.message}</td></tr>)}</tbody></table></div></>}</section>}
        {salesImport && <p className="success"><strong>{salesImport.file_name}</strong> 등록 완료: 월별 판매계획 {salesImport.item_count}건</p>}
        {salesItems.length > 0 && <><button type="button" className="preview-toggle" onClick={() => toggleUploadTable("sales")}>{expandedUploadTables.sales ? "표 접기" : "표 펼치기"}</button>{expandedUploadTables.sales && <div className="table-wrap upload-preview-table"><table><thead><tr><th>연월</th><th>고객사</th><th>제품</th><th>판매량(t)</th></tr></thead><tbody>{salesItems.map((item) => <tr key={item.id}><td>{item.year}-{String(item.month).padStart(2, "0")}</td><td>{item.customer}</td><td>{item.product_code}</td><td>{item.quantity_ton.toLocaleString()}</td></tr>)}</tbody></table></div>}</>}
        {view === "sales-daily" && monthlySales.length > 0 && <div className="table-wrap"><h3>일별 판매계획 환산</h3><p>토요일·일요일·공휴일을 제외한 영업일 수로 월 판매량을 균등 배분합니다.</p><table><thead><tr><th>연월</th><th>제품</th><th>월 판매계획(t)</th><th>영업일 평균 판매계획(t)</th></tr></thead><tbody>{monthlySales.map((item) => { const [year, month] = item.period.split("-").map(Number); const days = new Date(year, month, 0).getDate(); const workingDays = Array.from({ length: days }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`).filter((day) => !isSalesNonWorkingDay(day)).length; return <tr key={`${item.period}-${item.product}`}><td>{item.period}</td><td>{item.product}</td><td>{item.quantity.toFixed(2)}</td><td>{(item.quantity / Math.max(workingDays, 1)).toFixed(3)}</td></tr>; })}</tbody></table></div>}
      </section>
      <section className="card master-upload-card">
        <h2>Master Excel 등록</h2>
        <p>기존 <code>Data Dummy_Master.xlsx</code> 파일을 선택해 업로드하세요.</p>
        <form onSubmit={importMaster} className="upload-form">
          <input name="masterFile" type="file" accept=".xlsx" required />
          <button type="submit" disabled={isImporting}>{isImporting ? "등록 중..." : "Master 등록"}</button>
        </form>
        {importResult && <p className="success"><strong>{importResult.file_name}</strong> 등록 완료: {importResult.sheet_count}개 시트, {importResult.row_count}개 원본 행, 제품 {importResult.product_count}개, 공장 {importResult.plant_count}개, 라인 {importResult.line_count}개, 라인-제품 연결 {importResult.line_product_count}개, BOM {importResult.bom_item_count}개</p>}
      </section>
      <section className="card product-master-card">
        <h2>Master 제품 기준정보</h2>
        <p>현재 적용 Master 파일에 등록된 제품만 표시합니다.</p>
        {error && <p className="error">{error}</p>}
        <ul>
          {products.map((product) => <li key={product.code}><span><strong>{product.code}</strong> — {product.name}</span></li>)}
          {!products.length && <li>현재 적용 Master 파일에 등록된 제품이 없습니다.</li>}
        </ul>
      </section>
    </main>
  );
}
