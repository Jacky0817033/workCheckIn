import { File, Paths } from 'expo-file-system/next';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    where,
} from "firebase/firestore";
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { db } from '../constants/firebaseConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthSchedule {
    rest_days: number;
    holidays: number;
}

type AttendanceStatus = 'off' | 'leave';
type AttendanceMap = Record<string, AttendanceStatus>;

interface Employee {
    id: string;
    name: string;
    store_name: string;
    type: 'monthly' | 'hourly' | 'mixed';
    base_salary: number;        // 月薪制/混合制 = 月薪底薪；時薪制 = 時薪
    is_insured_here: boolean;
}

interface InsuranceTier {
    min: number; max: number; labor: number; health: number;
}

interface PayrollData {
    employee_id: string;
    employee_name: string;
    store_name: string;
    year_month: string;
    type: string;
    base_salary: number;
    hours_worked: number;       // 時薪制用
    extra_hours: number;        // 混合制：額外時薪工時
    extra_hourly_rate: number;  // 混合制：本月時薪
    bonus_growth: number;
    bonus_sqc: number;
    transport: number;
    rest_day_days: number;      // 休息日加班天數（時薪/混合制）
    holiday_days: number;
    rest_day_pay: number;
    holiday_pay: number;
    labor: number;
    health: number;
    shortage: number;
    advance: number;
    manual_adjustment: number;
    working_days: number;
    note: string;
    total_pay: number;
    attendance: AttendanceMap;
    created_at: any;
}

interface LaborInspectionRecord {
    employee_id: string;
    employee_name: string;
    store_name: string;
    pay_type: 'monthly' | 'hourly';
    base_salary: number;        // 月薪制：月薪；時薪制：時薪
    hours_worked: number;       // 時薪制：本月工時
    rest_day_days: number;      // 休息日加班天數（兩種制度）
    holiday_days: number;       // 國定假日天數（時薪制）
    holiday_hours: number;      // 國定假日時數（月薪制）
    labor: number;              // 勞保個人負擔
    health: number;             // 健保個人負擔
    gross_pay: number;          // 應領
    net_pay: number;            // 實領
    updated_at: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentYearMonth(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(ym: string, delta: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '00')}`;
}

function formatYM(ym: string): string {
    const [y, m] = ym.split('-');
    return `${y}年${parseInt(m)}月`;
}

function getDaysInMonth(ym: string): number {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function getFirstDayOfWeek(ym: string): number {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).getDay();
}

function getInsurance(salary: number, tiers: InsuranceTier[]): { labor: number; health: number } {
    const tier = tiers.find(t => salary >= t.min && salary <= t.max);
    return tier ? { labor: tier.labor, health: tier.health } : { labor: 0, health: 0 };
}

function typeLabel(type: string): string {
    if (type === 'monthly') return '月薪';
    if (type === 'hourly') return '時薪';
    return '月薪＋時薪';
}

/**
 * 勞基法 休息日加班費（時薪/混合制適用）
 * 每天以 8 小時計：前2hr×1.34 + 後6hr×1.67
 */
function calcRestDayPay(days: number, hourlyRate: number): number {
    if (days <= 0 || hourlyRate <= 0) return 0;
    return Math.round(days * hourlyRate * (2 * 1.34 + 6 * 1.67));
}

/**
 * 勞基法 國定假日出勤加給
 * 月薪/混合制：月薪÷30×天數
 * 時薪制：時薪×8×天數
 */
function calcHolidayPay(days: number, type: string, baseSalary: number): number {
    if (days <= 0) return 0;
    if (type === 'hourly') return Math.round(baseSalary * 8 * days);
    return Math.round((baseSalary / 30) * days);
}

// ─── Main Component ───────────────────────────────────────────────────────────

type MainView = 'payroll' | 'labor';

export default function PayrollService() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [payrollMap, setPayrollMap] = useState<Record<string, PayrollData>>({});
    const [laborMap, setLaborMap] = useState<Record<string, LaborInspectionRecord>>({});
    const [tiers, setTiers] = useState<InsuranceTier[]>([]);
    const [yearMonth, setYearMonth] = useState(currentYearMonth);
    const [loading, setLoading] = useState(true);
    const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
    const [schedule, setSchedule] = useState<MonthSchedule>({ rest_days: 0, holidays: 0 });
    const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
    const [mainView, setMainView] = useState<MainView>('payroll');
    const [printMode, setPrintMode] = useState(false);
    const [printSelected, setPrintSelected] = useState<Set<string>>(new Set());

    const togglePrintSelect = (id: string) => {
        setPrintSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    useEffect(() => {
        const unsubEmp = onSnapshot(
            query(collection(db, "employees"), orderBy("store_name", "asc")),
            snap => {
                setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
                setLoading(false);
            }
        );
        getDocs(query(collection(db, "insurance_tiers"), orderBy("min", "asc")))
            .then(snap => setTiers(snap.docs.map(d => d.data() as InsuranceTier)));
        const unsubLabor = onSnapshot(
            collection(db, "labor_inspection"),
            snap => {
                const map: Record<string, LaborInspectionRecord> = {};
                snap.docs.forEach(d => { map[d.id] = d.data() as LaborInspectionRecord; });
                setLaborMap(map);
            }
        );
        return () => { unsubEmp(); unsubLabor(); };
    }, []);

    useEffect(() => {
        const unsub = onSnapshot(
            query(collection(db, "payroll_records"), where("year_month", "==", yearMonth)),
            snap => {
                const map: Record<string, PayrollData> = {};
                snap.docs.forEach(d => { const r = d.data() as PayrollData; map[r.employee_id] = r; });
                setPayrollMap(map);
            }
        );
        return () => unsub();
    }, [yearMonth]);

    useEffect(() => {
        getDocs(collection(db, "monthly_schedule")).then(snap => {
            const d = snap.docs.find(d => d.id === yearMonth);
            if (d) setSchedule(d.data() as MonthSchedule);
            else setSchedule({ rest_days: 0, holidays: 0 });
        });
    }, [yearMonth]);

    const monthlyTotal = useMemo(
        () => Object.values(payrollMap).reduce((sum, r) => sum + (r.total_pay || 0), 0),
        [payrollMap]
    );

    const exportBatchCSV = async () => {
        const csv = buildBatchExternalCSV(employees, payrollMap, yearMonth, schedule);
        const file = new File(Paths.document, `薪資報表_${yearMonth}.csv`);
        file.write(csv);
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    };

    const exportLaborCSV = async () => {
        const csv = buildLaborCSV(employees, laborMap);
        const file = new File(Paths.document, `薪資資料_${new Date().getFullYear()}.csv`);
        file.write(csv);
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    };

    const printBatch = async () => {
        const items = employees
            .filter(e => printSelected.has(e.id) && payrollMap[e.id])
            .map(e => ({ employee: e, rec: payrollMap[e.id] }));
        if (items.length === 0) {
            Alert.alert('提示', '選取的員工中沒有已儲存的薪資紀錄');
            return;
        }
        const html = buildBatchInternalPDF(items, yearMonth);
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri);
    };

    if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#007AFF" /></View>;

    return (
        <View style={s.container}>
            {/* Month Selector */}
            <View style={s.monthBar}>
                <TouchableOpacity style={s.monthArrow} onPress={() => setYearMonth(m => shiftMonth(m, -1))}>
                    <Text style={s.monthArrowText}>‹</Text>
                </TouchableOpacity>
                <View style={s.monthCenter}>
                    <Text style={s.monthText}>{formatYM(yearMonth)}</Text>
                    <Text style={s.monthTotal}>本月發薪總計 ${monthlyTotal.toLocaleString()}</Text>
                </View>
                <TouchableOpacity style={s.monthArrow} onPress={() => setYearMonth(m => shiftMonth(m, 1))}>
                    <Text style={s.monthArrowText}>›</Text>
                </TouchableOpacity>
            </View>

            {/* Tab Switch */}
            <View style={s.tabRow}>
                <TouchableOpacity
                    style={[s.tabBtn, mainView === 'payroll' && s.tabBtnActive]}
                    onPress={() => setMainView('payroll')}
                >
                    <Text style={[s.tabBtnText, mainView === 'payroll' && s.tabBtnTextActive]}>薪資發放</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[s.tabBtn, mainView === 'labor' && s.tabBtnActive]}
                    onPress={() => setMainView('labor')}
                >
                    <Text style={[s.tabBtnText, mainView === 'labor' && s.tabBtnTextActive]}>勞檢管理</Text>
                </TouchableOpacity>
            </View>

            {mainView === 'payroll' ? (
                <>
                    {/* Schedule Row */}
                    <TouchableOpacity style={s.scheduleRow} onPress={() => setScheduleModalVisible(true)}>
                        <Text style={s.scheduleLabel}>本月排班</Text>
                        <Text style={s.scheduleValue}>{schedule.holidays}例{schedule.rest_days}休</Text>
                        <Text style={s.scheduleEdit}>✎ 設定</Text>
                    </TouchableOpacity>

                    {/* Buttons Row */}
                    {!printMode ? (
                        <View style={s.actionRow}>
                            <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#FF9500' }]} onPress={exportBatchCSV}>
                                <Text style={s.actionBtnText}>匯出薪資報表</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#34C759' }]} onPress={() => setPrintMode(true)}>
                                <Text style={s.actionBtnText}>批次列印</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={s.printModeBar}>
                            <TouchableOpacity
                                style={s.printSelectAllBtn}
                                onPress={() => {
                                    const withRecord = employees.filter(e => payrollMap[e.id]).map(e => e.id);
                                    if (printSelected.size === withRecord.length) {
                                        setPrintSelected(new Set());
                                    } else {
                                        setPrintSelected(new Set(withRecord));
                                    }
                                }}
                            >
                                <Text style={s.printSelectAllText}>全選</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[s.printConfirmBtn, printSelected.size === 0 && { opacity: 0.4 }]}
                                onPress={printBatch}
                                disabled={printSelected.size === 0}
                            >
                                <Text style={s.printConfirmText}>列印選取 ({printSelected.size}) 人</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.printCancelBtn} onPress={() => { setPrintMode(false); setPrintSelected(new Set()); }}>
                                <Text style={s.printCancelText}>取消</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Employee List */}
                    <FlatList
                        data={employees}
                        keyExtractor={e => e.id}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                        renderItem={({ item }) => {
                            const record = payrollMap[item.id];
                            const paid = !!record;
                            const isChecked = printSelected.has(item.id);
                            return (
                                <TouchableOpacity
                                    style={s.card}
                                    onPress={() => printMode ? togglePrintSelect(item.id) : setSelectedEmp(item)}
                                >
                                    {printMode && (
                                        <View style={[s.checkbox, isChecked && s.checkboxChecked]}>
                                            {isChecked && <Text style={s.checkmark}>✓</Text>}
                                        </View>
                                    )}
                                    <View style={{ flex: 1 }}>
                                        <Text style={s.empName}>{item.name}</Text>
                                        <Text style={s.empSub}>{item.store_name} · {typeLabel(item.type)}</Text>
                                        {paid && <Text style={s.paidAmt}>已發 ${record.total_pay.toLocaleString()}</Text>}
                                    </View>
                                    {!printMode && (
                                        <View style={[s.statusBadge, paid ? s.badgePaid : s.badgeUnpaid]}>
                                            <Text style={[s.statusText, paid ? s.statusPaid : s.statusUnpaid]}>
                                                {paid ? '✓ 已發薪' : '未發薪'}
                                            </Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        }}
                        ListEmptyComponent={<Text style={s.emptyText}>尚無員工資料</Text>}
                    />

                    <ScheduleModal
                        visible={scheduleModalVisible}
                        yearMonth={yearMonth}
                        current={schedule}
                        onSave={saved => { setSchedule(saved); setScheduleModalVisible(false); }}
                        onClose={() => setScheduleModalVisible(false)}
                    />
                </>
            ) : (
                <LaborInspectionView
                    employees={employees}
                    laborMap={laborMap}
                    tiers={tiers}
                    onExport={exportLaborCSV}
                />
            )}

            {selectedEmp && (
                <PayrollDetailModal
                    employee={selectedEmp}
                    yearMonth={yearMonth}
                    existingRecord={payrollMap[selectedEmp.id] ?? null}
                    tiers={tiers}
                    onClose={() => setSelectedEmp(null)}
                />
            )}
        </View>
    );
}

// ─── Labor Inspection View ────────────────────────────────────────────────────

function LaborInspectionView({ employees, laborMap, tiers, onExport }: {
    employees: Employee[];
    laborMap: Record<string, LaborInspectionRecord>;
    tiers: InsuranceTier[];
    onExport: () => void;
}) {
    const [editEmp, setEditEmp] = useState<Employee | null>(null);

    return (
        <>
            <TouchableOpacity style={[s.batchBtn, { backgroundColor: '#5856D6' }]} onPress={onExport}>
                <Text style={s.batchBtnText}>匯出員工清冊</Text>
            </TouchableOpacity>
            <FlatList
                data={employees}
                keyExtractor={e => e.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                renderItem={({ item }) => {
                    const rec = laborMap[item.id];
                    return (
                        <TouchableOpacity style={s.card} onPress={() => setEditEmp(item)}>
                            <View style={{ flex: 1 }}>
                                <Text style={s.empName}>{item.name}</Text>
                                <Text style={s.empSub}>{item.store_name}</Text>
                                {rec && <Text style={s.empSub}>{rec.pay_type === 'monthly' ? '月薪' : '時薪'} · 應領 ${rec.gross_pay.toLocaleString()}</Text>}
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                {rec
                                    ? <Text style={s.laborSalary}>實領 ${rec.net_pay.toLocaleString()}</Text>
                                    : <Text style={s.laborEmpty}>未設定</Text>
                                }
                                <Text style={s.laborEdit}>點擊修改</Text>
                            </View>
                        </TouchableOpacity>
                    );
                }}
                ListEmptyComponent={<Text style={s.emptyText}>尚無員工資料</Text>}
            />
            {editEmp && (
                <LaborEditModal
                    employee={editEmp}
                    current={laborMap[editEmp.id] ?? null}
                    tiers={tiers}
                    onClose={() => setEditEmp(null)}
                />
            )}
        </>
    );
}

function LaborEditModal({ employee, current, tiers, onClose }: {
    employee: Employee;
    current: LaborInspectionRecord | null;
    tiers: InsuranceTier[];
    onClose: () => void;
}) {
    const defaultPayType = current?.pay_type ?? (employee.type === 'hourly' ? 'hourly' : 'monthly');
    const [payType, setPayType] = useState<'monthly' | 'hourly'>(defaultPayType);
    const [baseSalary, setBaseSalary] = useState(current?.base_salary?.toString() ?? employee.base_salary.toString());
    const [hoursWorked, setHoursWorked] = useState(current?.hours_worked?.toString() ?? '');
    const [restDayDays, setRestDayDays] = useState(current?.rest_day_days?.toString() ?? '0');
    const [holidayDays, setHolidayDays] = useState(current?.holiday_days?.toString() ?? '0');
    const [holidayHours, setHolidayHours] = useState(current?.holiday_hours?.toString() ?? '0');
    const [laborInput, setLaborInput] = useState(current?.labor?.toString() ?? '');
    const [healthInput, setHealthInput] = useState(current?.health?.toString() ?? '');
    const [saving, setSaving] = useState(false);

    const isHourly = payType === 'hourly';

    const effectiveHourlyRate = useMemo(() => {
        const base = parseFloat(baseSalary || '0');
        return isHourly ? base : base / 30 / 8;
    }, [baseSalary, isHourly]);

    const basePay = useMemo(() => {
        const base = parseFloat(baseSalary || '0');
        return isHourly ? base * parseFloat(hoursWorked || '0') : base;
    }, [baseSalary, hoursWorked, isHourly]);

    const restDayPay = useMemo(() =>
        calcRestDayPay(parseFloat(restDayDays || '0'), effectiveHourlyRate)
        , [restDayDays, effectiveHourlyRate]);

    const holidayPay = useMemo(() => {
        if (isHourly) {
            const days = parseFloat(holidayDays || '0');
            return days > 0 ? Math.round(parseFloat(baseSalary || '0') * 8 * days) : 0;
        }
        const hrs = parseFloat(holidayHours || '0');
        return hrs > 0 ? Math.round(effectiveHourlyRate * hrs) : 0;
    }, [isHourly, holidayDays, holidayHours, baseSalary, effectiveHourlyRate]);

    const grossPay = useMemo(() => basePay + restDayPay + holidayPay, [basePay, restDayPay, holidayPay]);

    const insurance = useMemo(() => {
        if (!employee.is_insured_here) return { labor: 0, health: 0 };
        return getInsurance(grossPay, tiers);
    }, [grossPay, tiers, employee.is_insured_here]);

    const netPay = useMemo(() => grossPay - parseFloat(laborInput || '0') - parseFloat(healthInput || '0'), [grossPay, laborInput, healthInput]);

    const save = async () => {
        setSaving(true);
        try {
            const rec: LaborInspectionRecord = {
                employee_id: employee.id,
                employee_name: employee.name,
                store_name: employee.store_name,
                pay_type: payType,
                base_salary: parseFloat(baseSalary || '0'),
                hours_worked: parseFloat(hoursWorked || '0'),
                rest_day_days: parseFloat(restDayDays || '0'),
                holiday_days: parseFloat(holidayDays || '0'),
                holiday_hours: parseFloat(holidayHours || '0'),
                labor: parseFloat(laborInput || '0'),
                health: parseFloat(healthInput || '0'),
                gross_pay: grossPay,
                net_pay: netPay,
                updated_at: new Date(),
            };
            await setDoc(doc(db, 'labor_inspection', employee.id), rec);
            onClose();
        } catch (e: any) {
            Alert.alert('錯誤', e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible animationType="slide">
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                <View style={s.navBar}>
                    <TouchableOpacity onPress={onClose}>
                        <Text style={s.navBack}>‹ 返回</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                        <Text style={s.saveBtnText}>{saving ? '儲存中...' : '儲存'}</Text>
                    </TouchableOpacity>
                </View>

                <Text style={s.modalTitle}>{employee.name}</Text>
                <Text style={s.modalSub}>{employee.store_name} · 勞工局員工清冊</Text>

                {/* 計薪方式 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>計薪方式</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TouchableOpacity
                            style={[s.laborTypeBtn, !isHourly && s.laborTypeBtnActive]}
                            onPress={() => setPayType('monthly')}
                        >
                            <Text style={[s.laborTypeBtnText, !isHourly && s.laborTypeBtnTextActive]}>月薪制</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[s.laborTypeBtn, isHourly && s.laborTypeBtnActive]}
                            onPress={() => setPayType('hourly')}
                        >
                            <Text style={[s.laborTypeBtnText, isHourly && s.laborTypeBtnTextActive]}>時薪制</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 薪資 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>薪資</Text>
                    <SalaryRow
                        label={isHourly ? '時薪（元/時）' : '月薪（元）'}
                        value={baseSalary}
                        onChange={setBaseSalary}
                    />
                    {isHourly && (
                        <SalaryRow label="本月工時（小時）" value={hoursWorked} onChange={setHoursWorked} />
                    )}
                    <View style={s.basePayBox}>
                        <Text style={s.basePayLabel}>{isHourly ? '基本工資' : '月薪'}</Text>
                        <Text style={s.basePayValue}>${basePay.toLocaleString()}</Text>
                    </View>
                </View>

                {/* 加班 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>加班</Text>
                    <SalaryRow label="休息日加班天數" value={restDayDays} onChange={setRestDayDays} placeholder="天" />
                    {restDayPay > 0 && (
                        <View style={s.calcHint}>
                            <Text style={s.calcHintText}>
                                → 休息日加班費 ${restDayPay.toLocaleString()}{'\n'}
                                （{isHourly ? '時薪' : '月薪÷30÷8'} × (2×1.34+6×1.67) × {restDayDays}天）
                            </Text>
                        </View>
                    )}

                    {isHourly ? (
                        <>
                            <SalaryRow label="國定假日出勤天數" value={holidayDays} onChange={setHolidayDays} placeholder="天" />
                            {holidayPay > 0 && (
                                <View style={s.calcHint}>
                                    <Text style={s.calcHintText}>→ 國定假日加給 ${holidayPay.toLocaleString()}（時薪×8×天數）</Text>
                                </View>
                            )}
                        </>
                    ) : (
                        <>
                            <SalaryRow label="國定假日出勤時數" value={holidayHours} onChange={setHolidayHours} placeholder="小時" />
                            {holidayPay > 0 && (
                                <View style={s.calcHint}>
                                    <Text style={s.calcHintText}>→ 國定假日加給 ${holidayPay.toLocaleString()}（月薪÷30÷8×時數）</Text>
                                </View>
                            )}
                        </>
                    )}
                </View>

                {/* 個人負擔 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>個人負擔</Text>
                    {employee.is_insured_here && insurance.labor > 0 && (
                        <TouchableOpacity style={s.autoFillHint} onPress={() => { setLaborInput(insurance.labor.toString()); setHealthInput(insurance.health.toString()); }}>
                            <Text style={s.autoFillHintText}>依投保級距試算：勞保 ${insurance.labor.toLocaleString()} / 健保 ${insurance.health.toLocaleString()}　　點此帶入 ↓</Text>
                        </TouchableOpacity>
                    )}
                    {!employee.is_insured_here && (
                        <Text style={s.hint}>此員工非本店投保，保費為 $0</Text>
                    )}
                    <SalaryRow label="勞保（個人負擔）" value={laborInput} onChange={setLaborInput} placeholder="0" />
                    <SalaryRow label="健保（個人負擔）" value={healthInput} onChange={setHealthInput} placeholder="0" />
                </View>

                {/* 應領 / 實領 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>薪資摘要</Text>
                    <View style={s.basePayBox}>
                        <Text style={s.basePayLabel}>應領金額</Text>
                        <Text style={s.basePayValue}>${grossPay.toLocaleString()}</Text>
                    </View>
                </View>

                <View style={s.netPayBox}>
                    <Text style={s.netPayLabel}>實領金額</Text>
                    <Text style={[s.netPayValue, netPay < 0 && { color: '#FF3B30' }]}>
                        ${netPay.toLocaleString()}
                    </Text>
                </View>
            </ScrollView>
        </Modal>
    );
}

// ─── Payroll Detail Modal ─────────────────────────────────────────────────────

function PayrollDetailModal({ employee, yearMonth, existingRecord, tiers, onClose }: {
    employee: Employee;
    yearMonth: string;
    existingRecord: PayrollData | null;
    tiers: InsuranceTier[];
    onClose: () => void;
}) {
    const rec = existingRecord;
    const isMixed = employee.type === 'mixed';
    const isHourly = employee.type === 'hourly';
    const hasRestDay = isHourly || isMixed;

    const [attendance, setAttendance] = useState<AttendanceMap>(rec?.attendance ?? {});
    const [hours, setHours] = useState(rec?.hours_worked?.toString() ?? '');
    const [extraHours, setExtraHours] = useState(rec?.extra_hours?.toString() ?? '');
    const [extraHourlyRate, setExtraHourlyRate] = useState(rec?.extra_hourly_rate?.toString() ?? '');
    const [bonusGrowth, setBonusGrowth] = useState(rec?.bonus_growth?.toString() ?? '0');
    const [bonusSQC, setBonusSQC] = useState(rec?.bonus_sqc?.toString() ?? '0');
    const [transport, setTransport] = useState(rec?.transport?.toString() ?? '0');
    const [shortage, setShortage] = useState(rec?.shortage?.toString() ?? '0');
    const [advance, setAdvance] = useState(rec?.advance?.toString() ?? '0');
    const [manualAdj, setManualAdj] = useState(rec?.manual_adjustment?.toString() ?? '0');
    const [workingDays, setWorkingDays] = useState(rec?.working_days?.toString() ?? '');
    const [restDayDays, setRestDayDays] = useState(rec?.rest_day_days?.toString() ?? '0');
    const [holidayDays, setHolidayDays] = useState(rec?.holiday_days?.toString() ?? '0');
    const [note, setNote] = useState(rec?.note ?? '');
    const [laborInput, setLaborInput] = useState(rec?.labor?.toString() ?? '');
    const [healthInput, setHealthInput] = useState(rec?.health?.toString() ?? '');
    const [saving, setSaving] = useState(false);

    // 計算時薪（用於休息日加班）
    const effectiveHourlyRate = useMemo(() => {
        if (isHourly) return employee.base_salary;
        if (isMixed) return parseFloat(extraHourlyRate || '0');
        return 0;
    }, [isHourly, isMixed, employee.base_salary, extraHourlyRate]);

    const basePay = useMemo(() => {
        if (isHourly) return parseFloat(hours || '0') * employee.base_salary;
        if (isMixed) return employee.base_salary + parseFloat(extraHours || '0') * parseFloat(extraHourlyRate || '0');
        return employee.base_salary;
    }, [employee, isHourly, isMixed, hours, extraHours, extraHourlyRate]);

    const insurance = useMemo(() => {
        if (!employee.is_insured_here) return { labor: 0, health: 0 };
        return getInsurance(basePay, tiers);
    }, [basePay, employee.is_insured_here, tiers]);

    const restDayPay = useMemo(() =>
        hasRestDay ? calcRestDayPay(parseFloat(restDayDays || '0'), effectiveHourlyRate) : 0
        , [restDayDays, effectiveHourlyRate, hasRestDay]);

    const holidayPay = useMemo(() =>
        calcHolidayPay(parseFloat(holidayDays || '0'), employee.type, employee.base_salary)
        , [holidayDays, employee]);

    const totalPay = useMemo(() => {
        const income = basePay
            + parseFloat(bonusGrowth || '0')
            + parseFloat(bonusSQC || '0')
            + parseFloat(transport || '0')
            + restDayPay
            + holidayPay;
        const deduct = parseFloat(laborInput || '0') + parseFloat(healthInput || '0')
            + parseFloat(shortage || '0')
            + parseFloat(advance || '0');
        return income - deduct + parseFloat(manualAdj || '0');
    }, [basePay, bonusGrowth, bonusSQC, transport, restDayPay, holidayPay, laborInput, healthInput, shortage, advance, manualAdj]);

    const toggleAttendance = (day: string) => {
        setAttendance(prev => {
            const cur = prev[day];
            if (!cur) return { ...prev, [day]: 'off' };
            if (cur === 'off') return { ...prev, [day]: 'leave' };
            const next = { ...prev };
            delete next[day];
            return next;
        });
    };

    const copyPrevMonth = async () => {
        const prevYM = shiftMonth(yearMonth, -1);
        const snap = await getDoc(doc(db, 'payroll_records', `${employee.id}_${prevYM}`));
        if (!snap.exists()) {
            Alert.alert('提示', `${formatYM(prevYM)} 無薪資紀錄可複製`);
            return;
        }
        const d = snap.data() as PayrollData;
        setHours(d.hours_worked?.toString() ?? '');
        setExtraHours(d.extra_hours?.toString() ?? '');
        setExtraHourlyRate(d.extra_hourly_rate?.toString() ?? '');
        setBonusGrowth(d.bonus_growth?.toString() ?? '0');
        setBonusSQC(d.bonus_sqc?.toString() ?? '0');
        setTransport(d.transport?.toString() ?? '0');
        setShortage(d.shortage?.toString() ?? '0');
        setAdvance(d.advance?.toString() ?? '0');
        setManualAdj(d.manual_adjustment?.toString() ?? '0');
        setWorkingDays(d.working_days?.toString() ?? '');
        setRestDayDays(d.rest_day_days?.toString() ?? '0');
        setHolidayDays(d.holiday_days?.toString() ?? '0');
        setNote(d.note ?? '');
        setLaborInput(d.labor?.toString() ?? '');
        setHealthInput(d.health?.toString() ?? '');
        Alert.alert('完成', `已複製 ${formatYM(prevYM)} 的資料，請確認後再儲存`);
    };

    const save = async () => {
        setSaving(true);
        try {
            const data: PayrollData = {
                employee_id: employee.id,
                employee_name: employee.name,
                store_name: employee.store_name,
                year_month: yearMonth,
                type: employee.type,
                base_salary: employee.base_salary,
                hours_worked: parseFloat(hours || '0'),
                extra_hours: parseFloat(extraHours || '0'),
                extra_hourly_rate: parseFloat(extraHourlyRate || '0'),
                bonus_growth: parseFloat(bonusGrowth || '0'),
                bonus_sqc: parseFloat(bonusSQC || '0'),
                transport: parseFloat(transport || '0'),
                rest_day_days: parseFloat(restDayDays || '0'),
                holiday_days: parseFloat(holidayDays || '0'),
                rest_day_pay: restDayPay,
                holiday_pay: holidayPay,
                labor: parseFloat(laborInput || '0'),
                health: parseFloat(healthInput || '0'),
                shortage: parseFloat(shortage || '0'),
                advance: parseFloat(advance || '0'),
                manual_adjustment: parseFloat(manualAdj || '0'),
                working_days: parseFloat(workingDays || '0'),
                note,
                total_pay: totalPay,
                attendance,
                created_at: new Date(),
            };
            await setDoc(doc(db, "payroll_records", `${employee.id}_${yearMonth}`), data);
            Alert.alert("完成", "薪資紀錄已儲存");
        } catch (e: any) {
            Alert.alert("錯誤", e.message);
        } finally {
            setSaving(false);
        }
    };

    const printInternal = async () => {
        const html = buildInternalPDF(employee, yearMonth, {
            basePay,
            bonusGrowth: parseFloat(bonusGrowth || '0'),
            bonusSQC: parseFloat(bonusSQC || '0'),
            transport: parseFloat(transport || '0'),
            restDayPay,
            holidayPay,
            labor: parseFloat(laborInput || '0'),
            health: parseFloat(healthInput || '0'),
            shortage: parseFloat(shortage || '0'),
            advance: parseFloat(advance || '0'),
            manualAdj: parseFloat(manualAdj || '0'),
            note,
            totalPay,
            hoursWorked: parseFloat(hours || '0'),
            extraHours: parseFloat(extraHours || '0'),
            extraHourlyRate: parseFloat(extraHourlyRate || '0'),
        });
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        await Sharing.shareAsync(uri);
    };

    return (
        <Modal visible animationType="slide">
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                <View style={s.navBar}>
                    <TouchableOpacity onPress={onClose}>
                        <Text style={s.navBack}>‹ 返回</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                        <Text style={s.saveBtnText}>{saving ? '儲存中...' : '儲存紀錄'}</Text>
                    </TouchableOpacity>
                </View>

                <Text style={s.modalTitle}>{employee.name}</Text>
                <Text style={s.modalSub}>{formatYM(yearMonth)} · {employee.store_name} · {typeLabel(employee.type)}</Text>

                {!existingRecord && (
                    <TouchableOpacity style={s.copyPrevBtn} onPress={copyPrevMonth}>
                        <Text style={s.copyPrevText}>↩ 複製上月資料（{formatYM(shiftMonth(yearMonth, -1))}）</Text>
                    </TouchableOpacity>
                )}

                {/* Attendance Calendar */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>出勤記錄</Text>
                    <Text style={s.hint}>點擊日期切換：空白＝上班　藍＝休假　橘＝請假</Text>
                    <AttendanceCalendar yearMonth={yearMonth} attendance={attendance} onToggle={toggleAttendance} />
                </View>

                {/* Salary */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>薪資計算</Text>

                    {/* 時薪制：輸入工時 */}
                    {isHourly && (
                        <SalaryRow label="本月工時（小時）" value={hours} onChange={setHours} />
                    )}

                    {/* 混合制：顯示底薪 + 輸入額外工時與時薪 */}
                    {isMixed && (
                        <>
                            <View style={s.basePayBox}>
                                <Text style={s.basePayLabel}>月薪底薪</Text>
                                <Text style={s.basePayValue}>${employee.base_salary.toLocaleString()}</Text>
                            </View>
                            <Text style={s.groupLabel}>額外時薪班</Text>
                            <SalaryRow label="本月額外工時（小時）" value={extraHours} onChange={setExtraHours} />
                            <SalaryRow label="時薪（元/hr）" value={extraHourlyRate} onChange={setExtraHourlyRate} />
                            {parseFloat(extraHours || '0') > 0 && parseFloat(extraHourlyRate || '0') > 0 && (
                                <View style={s.calcHint}>
                                    <Text style={s.calcHintText}>
                                        → 額外時薪 ${(parseFloat(extraHours || '0') * parseFloat(extraHourlyRate || '0')).toLocaleString()}
                                    </Text>
                                </View>
                            )}
                        </>
                    )}

                    {/* 月薪制：直接顯示底薪 */}
                    {!isMixed && (
                        <View style={s.basePayBox}>
                            <Text style={s.basePayLabel}>基本薪資</Text>
                            <Text style={s.basePayValue}>${basePay.toLocaleString()}</Text>
                        </View>
                    )}

                    {/* 混合制：顯示合計 */}
                    {isMixed && (
                        <View style={[s.basePayBox, { marginTop: 6 }]}>
                            <Text style={s.basePayLabel}>本月薪資合計</Text>
                            <Text style={s.basePayValue}>${basePay.toLocaleString()}</Text>
                        </View>
                    )}

                    {/* 加班 / 假日 */}
                    <Text style={s.groupLabel}>加班 / 假日</Text>

                    {/* 休息日：只有時薪/混合制 */}
                    {hasRestDay && (
                        <>
                            <SalaryRow label="休息日加班天數（天）" value={restDayDays} onChange={setRestDayDays} placeholder="天" />
                            {restDayPay > 0 && (
                                <View style={s.calcHint}>
                                    <Text style={s.calcHintText}>
                                        → 休息日加班費 ${restDayPay.toLocaleString()}（時薪×(2×1.34+6×1.67)×天數）
                                    </Text>
                                </View>
                            )}
                        </>
                    )}

                    {/* 國定假日：所有類型 */}
                    <SalaryRow label="國定假日出勤天數" value={holidayDays} onChange={setHolidayDays} placeholder="天" />
                    {holidayPay > 0 && (
                        <View style={s.calcHint}>
                            <Text style={s.calcHintText}>
                                → 國定假日加給 ${holidayPay.toLocaleString()}（{employee.type === 'hourly' ? '時薪×8×天數' : '月薪÷30×天數'}）
                            </Text>
                        </View>
                    )}

                    <Text style={s.groupLabel}>獎金項目</Text>
                    <SalaryRow label="日商成長獎金" value={bonusGrowth} onChange={setBonusGrowth} />
                    <SalaryRow label="SQC 獎金" value={bonusSQC} onChange={setBonusSQC} />
                    <SalaryRow label="車馬費" value={transport} onChange={setTransport} />

                    <Text style={s.groupLabel}>扣款項目</Text>
                    {employee.is_insured_here && insurance.labor > 0 && (
                        <TouchableOpacity style={s.autoFillHint} onPress={() => { setLaborInput(insurance.labor.toString()); setHealthInput(insurance.health.toString()); }}>
                            <Text style={s.autoFillHintText}>依投保級距試算：勞保 ${insurance.labor.toLocaleString()} / 健保 ${insurance.health.toLocaleString()}　　點此帶入 ↓</Text>
                        </TouchableOpacity>
                    )}
                    <SalaryRow label="勞保（個人負擔）" value={laborInput} onChange={setLaborInput} placeholder="0" />
                    <SalaryRow label="健保（個人負擔）" value={healthInput} onChange={setHealthInput} placeholder="0" />
                    <SalaryRow label="收銀短少" value={shortage} onChange={setShortage} />
                    <SalaryRow label="預支薪資" value={advance} onChange={setAdvance} />

                    <Text style={s.groupLabel}>手動調整（正數加、負數減）</Text>
                    <SalaryRow label="調整金額" value={manualAdj} onChange={setManualAdj} placeholder="0" />

                    <Text style={s.groupLabel}>備註</Text>
                    <TextInput
                        style={s.noteInput}
                        value={note}
                        onChangeText={setNote}
                        placeholder="輸入備註（選填）"
                        multiline
                    />
                </View>

                {/* Net Pay */}
                <View style={s.netPayBox}>
                    <Text style={s.netPayLabel}>實領金額</Text>
                    <Text style={[s.netPayValue, totalPay < 0 && { color: '#FF3B30' }]}>
                        ${totalPay.toLocaleString()}
                    </Text>
                </View>

                {/* Export settings */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>匯出設定</Text>
                    <Text style={s.hint}>以下資訊用於本月批次匯出薪資報表</Text>
                    <SalaryRow label="出勤天數" value={workingDays} onChange={setWorkingDays} placeholder="實際出勤天數" />
                </View>

                {/* Print Button */}
                <TouchableOpacity style={s.printBtn} onPress={printInternal}>
                    <Text style={s.printBtnText}>列印薪資單（內部版）</Text>
                    <Text style={s.printBtnSub}>4張 / A4 · 萬國牌格式</Text>
                </TouchableOpacity>
            </ScrollView>
        </Modal>
    );
}

// ─── Attendance Calendar ──────────────────────────────────────────────────────

function AttendanceCalendar({ yearMonth, attendance, onToggle }: {
    yearMonth: string; attendance: AttendanceMap; onToggle: (day: string) => void;
}) {
    const days = getDaysInMonth(yearMonth);
    const firstDay = getFirstDayOfWeek(yearMonth);
    const cells: (number | null)[] = [
        ...Array(firstDay).fill(null),
        ...Array.from({ length: days }, (_, i) => i + 1),
    ];

    return (
        <View style={s.calendar}>
            <View style={s.calWeekRow}>
                {['日', '一', '二', '三', '四', '五', '六'].map(l => (
                    <Text key={l} style={s.calWeekLabel}>{l}</Text>
                ))}
            </View>
            <View style={s.calGrid}>
                {cells.map((day, i) => {
                    if (!day) return <View key={`e${i}`} style={s.calCell} />;
                    const key = String(day).padStart(2, '0');
                    const status = attendance[key];
                    return (
                        <TouchableOpacity
                            key={key}
                            style={[s.calCell, status === 'off' && s.calOff, status === 'leave' && s.calLeave]}
                            onPress={() => onToggle(key)}
                        >
                            <Text style={[s.calDayNum, status === 'off' && s.calOffText, status === 'leave' && s.calLeaveText]}>
                                {day}
                            </Text>
                            {status && (
                                <Text style={[s.calStatus, status === 'off' ? s.calOffText : s.calLeaveText]}>
                                    {status === 'off' ? '休' : '假'}
                                </Text>
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

// ─── Salary Row ───────────────────────────────────────────────────────────────

function SalaryRow({ label, value, onChange, placeholder }: {
    label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
    return (
        <View style={s.salaryRow}>
            <Text style={s.salaryLabel}>{label}</Text>
            <TextInput
                style={s.salaryInput} value={value} onChangeText={onChange}
                keyboardType="numeric" placeholder={placeholder ?? '0'} textAlign="right"
            />
        </View>
    );
}

// ─── Internal PDF (4 per A4, 萬國牌) ─────────────────────────────────────────

function buildInternalPDF(employee: Employee, yearMonth: string, data: {
    basePay: number; bonusGrowth: number; bonusSQC: number; transport: number;
    restDayPay: number; holidayPay: number;
    labor: number; health: number; shortage: number; advance: number;
    manualAdj: number; note: string; totalPay: number;
    hoursWorked?: number; extraHours?: number; extraHourlyRate?: number;
}): string {
    const { basePay, bonusGrowth, bonusSQC, transport, restDayPay, holidayPay,
        labor, health, shortage, advance, manualAdj, note, totalPay,
        hoursWorked = 0, extraHours = 0, extraHourlyRate = 0 } = data;
    const label = formatYM(yearMonth);

    const row = (name: string, val: number, minus = false) =>
        val > 0 ? `<div class="row"><span>${name}</span><span>${minus ? '-' : ''}$${val.toLocaleString()}</span></div>` : '';

    const basePayLines = () => {
        if (employee.type === 'hourly') {
            return `<div class="row"><span>時薪 $${employee.base_salary.toLocaleString()} × ${hoursWorked} 時</span><span>$${basePay.toLocaleString()}</span></div>`;
        }
        if (employee.type === 'mixed') {
            const extraPay = Math.round(extraHours * extraHourlyRate);
            return `<div class="row"><span>月薪底薪</span><span>$${employee.base_salary.toLocaleString()}</span></div>
          ${extraHours > 0 ? `<div class="row"><span>時薪 $${extraHourlyRate.toLocaleString()} × ${extraHours} 時</span><span>$${extraPay.toLocaleString()}</span></div>` : ''}
          <div class="row sub-total"><span>薪資合計</span><span>$${basePay.toLocaleString()}</span></div>`;
        }
        return `<div class="row"><span>月薪</span><span>$${basePay.toLocaleString()}</span></div>`;
    };

    const slip = (pos: string) => `
    <div class="slip ${pos}">
      <div class="hd">
        <div class="store">${employee.store_name}</div>
        <div class="title">${label}　薪　資　明　細</div>
        <div class="emp">姓名：${employee.name}　　${typeLabel(employee.type)}制</div>
      </div>
      <div class="cols">
        <div class="col">
          <div class="col-hd">應　領</div>
          ${basePayLines()}
          ${row('休息日加班費', restDayPay)}
          ${row('國定假日加給', holidayPay)}
          ${row('日商成長獎金', bonusGrowth)}
          ${row('SQC 獎金', bonusSQC)}
          ${row('車馬費', transport)}
          ${manualAdj !== 0 ? `<div class="row"><span>調整</span><span>${manualAdj > 0 ? '+' : '-'}$${Math.abs(manualAdj).toLocaleString()}</span></div>` : ''}
        </div>
        <div class="col">
          <div class="col-hd">應　扣</div>
          ${row('勞保費', labor, true)}
          ${row('健保費', health, true)}
          ${row('收銀短少', shortage, true)}
          ${row('預支薪資', advance, true)}
        </div>
      </div>
      <div class="total">
        <span>實　領　金　額</span>
        <span class="amt">$${totalPay.toLocaleString()}</span>
      </div>
      ${note ? `<div class="note">備註：${note}</div>` : ''}
    </div>`;

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @page { margin: 0; size: A4 portrait; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; height: 297mm; overflow: hidden; }
  body { font-family: 'Heiti TC','PingFang TC','Microsoft JhengHei',sans-serif; font-size: 9pt; }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; }
  .slip { position: absolute; width: 105mm; height: 148.5mm; overflow: hidden; padding: 4mm; box-sizing: border-box; border: 1px solid #444; display: flex; flex-direction: column; }
  .s1 { top: 0; left: 0; }
  .s2 { top: 0; left: 105mm; border-left: none; }
  .s3 { top: 148.5mm; left: 0; border-top: 2px dashed #aaa; }
  .s4 { top: 148.5mm; left: 105mm; border-top: 2px dashed #aaa; border-left: none; }
  .hd { text-align: center; padding-bottom: 2mm; border-bottom: 1px solid #333; margin-bottom: 2mm; flex-shrink: 0; }
  .store { font-size: 8pt; color: #666; }
  .title { font-size: 11pt; font-weight: bold; letter-spacing: 1px; margin: 1mm 0; }
  .emp { font-size: 8pt; }
  .cols { display: flex; flex: 1; gap: 2mm; margin-top: 2mm; overflow: hidden; min-height: 0; }
  .col { flex: 1; overflow: hidden; min-height: 0; }
  .col-hd { font-weight: bold; text-align: center; border-bottom: 1px solid #333; padding-bottom: 1mm; margin-bottom: 1.5mm; letter-spacing: 3px; font-size: 9pt; flex-shrink: 0; }
  .row { display: flex; justify-content: space-between; font-size: 8pt; padding: 0.8mm 0; border-bottom: 1px dotted #ddd; }
  .sub-total { font-weight: bold; border-bottom: 1px solid #999; background: #f8f8f8; }
  .total { display: flex; justify-content: space-between; align-items: center; border-top: 1.5px solid #333; padding-top: 2mm; margin-top: 2mm; font-weight: bold; font-size: 10pt; flex-shrink: 0; }
  .amt { font-size: 15pt; color: #cc0000; }
  .note { font-size: 7.5pt; color: #555; margin-top: 1mm; flex-shrink: 0; }
  .sign { font-size: 7pt; color: #888; text-align: right; margin-top: 2mm; }
</style>
</head><body>
<div class="page">
  ${slip('s1')}${slip('s2')}${slip('s3')}${slip('s4')}
</div>
</body></html>`;
}

// ─── Batch Internal PDF (multiple employees, 4 per A4 page) ──────────────────

function buildBatchInternalPDF(
    items: { employee: Employee; rec: PayrollData }[],
    yearMonth: string
): string {
    const label = formatYM(yearMonth);

    const row = (name: string, val: number, minus = false) =>
        val > 0 ? `<div class="row"><span>${name}</span><span>${minus ? '-' : ''}$${val.toLocaleString()}</span></div>` : '';

    const buildSlip = (employee: Employee, rec: PayrollData, pos: string) => {
        const basePay =
            employee.type === 'hourly' ? rec.hours_worked * rec.base_salary :
                employee.type === 'mixed' ? rec.base_salary + rec.extra_hours * rec.extra_hourly_rate :
                    rec.base_salary;
        const { bonus_growth, bonus_sqc, transport, rest_day_pay, holiday_pay,
            labor, health, shortage, advance, manual_adjustment, note, total_pay } = rec;

        const basePayLines = () => {
            if (employee.type === 'hourly') {
                return `<div class="row"><span>時薪 $${rec.base_salary.toLocaleString()} × ${rec.hours_worked} 時</span><span>$${basePay.toLocaleString()}</span></div>`;
            }
            if (employee.type === 'mixed') {
                const extraPay = Math.round(rec.extra_hours * rec.extra_hourly_rate);
                return `<div class="row"><span>月薪底薪</span><span>$${rec.base_salary.toLocaleString()}</span></div>
          ${rec.extra_hours > 0 ? `<div class="row"><span>時薪 $${rec.extra_hourly_rate.toLocaleString()} × ${rec.extra_hours} 時</span><span>$${extraPay.toLocaleString()}</span></div>` : ''}
          <div class="row sub-total"><span>薪資合計</span><span>$${basePay.toLocaleString()}</span></div>`;
            }
            return `<div class="row"><span>月薪</span><span>$${basePay.toLocaleString()}</span></div>`;
        };

        return `
    <div class="slip ${pos}">
      <div class="hd">
        <div class="store">${employee.store_name}</div>
        <div class="title">${label}　薪　資　明　細</div>
        <div class="emp">姓名：${employee.name}　　${typeLabel(employee.type)}制</div>
      </div>
      <div class="cols">
        <div class="col">
          <div class="col-hd">應　領</div>
          ${basePayLines()}
          ${row('休息日加班費', rest_day_pay)}
          ${row('國定假日加給', holiday_pay)}
          ${row('日商成長獎金', bonus_growth)}
          ${row('SQC 獎金', bonus_sqc)}
          ${row('車馬費', transport)}
          ${manual_adjustment !== 0 ? `<div class="row"><span>調整</span><span>${manual_adjustment > 0 ? '+' : '-'}$${Math.abs(manual_adjustment).toLocaleString()}</span></div>` : ''}
        </div>
        <div class="col">
          <div class="col-hd">應　扣</div>
          ${row('勞保費', labor, true)}
          ${row('健保費', health, true)}
          ${row('收銀短少', shortage, true)}
          ${row('預支薪資', advance, true)}
        </div>
      </div>
      <div class="total">
        <span>實　領　金　額</span>
        <span class="amt">$${total_pay.toLocaleString()}</span>
      </div>
      ${note ? `<div class="note">備註：${note}</div>` : ''}
    </div>`;
    };

    const positions = ['s1', 's2', 's3', 's4'];
    const emptySlip = (pos: string) => `<div class="slip ${pos}" style="visibility:hidden"></div>`;

    // Group into pages of 4
    const pages: string[] = [];
    for (let i = 0; i < items.length; i += 4) {
        const pageItems = items.slice(i, i + 4);
        const slips = pageItems.map(({ employee, rec }, idx) => buildSlip(employee, rec, positions[idx]));
        while (slips.length < 4) slips.push(emptySlip(positions[slips.length]));
        pages.push(`<div class="page">${slips.join('')}</div>`);
    }

    const css = `
  @page { margin: 0; size: A4 portrait; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; overflow: hidden; }
  body { font-family: 'Heiti TC','PingFang TC','Microsoft JhengHei',sans-serif; font-size: 9pt; }
  .page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
  .slip { position: absolute; width: 105mm; height: 148.5mm; overflow: hidden; padding: 4mm; box-sizing: border-box; border: 1px solid #444; display: flex; flex-direction: column; }
  .s1 { top: 0; left: 0; }
  .s2 { top: 0; left: 105mm; border-left: none; }
  .s3 { top: 148.5mm; left: 0; border-top: 2px dashed #aaa; }
  .s4 { top: 148.5mm; left: 105mm; border-top: 2px dashed #aaa; border-left: none; }
  .hd { text-align: center; padding-bottom: 2mm; border-bottom: 1px solid #333; margin-bottom: 2mm; flex-shrink: 0; }
  .store { font-size: 8pt; color: #666; }
  .title { font-size: 11pt; font-weight: bold; letter-spacing: 1px; margin: 1mm 0; }
  .emp { font-size: 8pt; }
  .cols { display: flex; flex: 1; gap: 2mm; margin-top: 2mm; overflow: hidden; min-height: 0; }
  .col { flex: 1; overflow: hidden; min-height: 0; }
  .col-hd { font-weight: bold; text-align: center; border-bottom: 1px solid #333; padding-bottom: 1mm; margin-bottom: 1.5mm; letter-spacing: 3px; font-size: 9pt; flex-shrink: 0; }
  .row { display: flex; justify-content: space-between; font-size: 8pt; padding: 0.8mm 0; border-bottom: 1px dotted #ddd; }
  .sub-total { font-weight: bold; border-bottom: 1px solid #999; background: #f8f8f8; }
  .total { display: flex; justify-content: space-between; align-items: center; border-top: 1.5px solid #333; padding-top: 2mm; margin-top: 2mm; font-weight: bold; font-size: 10pt; flex-shrink: 0; }
  .amt { font-size: 15pt; color: #cc0000; }
  .note { font-size: 7.5pt; color: #555; margin-top: 1mm; flex-shrink: 0; }
  .sign { font-size: 7pt; color: #888; text-align: right; margin-top: 2mm; }`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${pages.join('')}</body></html>`;
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────

function ScheduleModal({ visible, yearMonth, current, onSave, onClose }: {
    visible: boolean;
    yearMonth: string;
    current: MonthSchedule;
    onSave: (s: MonthSchedule) => void;
    onClose: () => void;
}) {
    const [holidays, setHolidays] = useState(String(current.holidays));
    const [restDays, setRestDays] = useState(String(current.rest_days));

    useEffect(() => {
        setHolidays(String(current.holidays));
        setRestDays(String(current.rest_days));
    }, [current, visible]);

    const save = async () => {
        const saved: MonthSchedule = {
            holidays: parseInt(holidays) || 0,
            rest_days: parseInt(restDays) || 0,
        };
        await setDoc(doc(db, 'monthly_schedule', yearMonth), saved);
        onSave(saved);
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={s.overlay}>
                <View style={s.scheduleCard}>
                    <Text style={s.scheduleCardTitle}>{formatYM(yearMonth)} 排班設定</Text>
                    <View style={s.scheduleInputRow}>
                        <Text style={s.scheduleInputLabel}>例假日（天）</Text>
                        <TextInput
                            style={s.scheduleInput}
                            keyboardType="number-pad"
                            value={holidays}
                            onChangeText={setHolidays}
                        />
                    </View>
                    <View style={s.scheduleInputRow}>
                        <Text style={s.scheduleInputLabel}>休息日（天）</Text>
                        <TextInput
                            style={s.scheduleInput}
                            keyboardType="number-pad"
                            value={restDays}
                            onChangeText={setRestDays}
                        />
                    </View>
                    <Text style={s.scheduleHint}>例：一例一休 → 例假日4、休息日4（4週）</Text>
                    <View style={s.scheduleActions}>
                        <TouchableOpacity style={s.scheduleCancelBtn} onPress={onClose}>
                            <Text style={s.scheduleCancelText}>取消</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.scheduleSaveBtn} onPress={save}>
                            <Text style={s.scheduleSaveText}>儲存</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

// ─── Batch External CSV ───────────────────────────────────────────────────────

function buildBatchExternalCSV(
    employees: Employee[],
    payrollMap: Record<string, PayrollData>,
    yearMonth: string,
    schedule: MonthSchedule
): string {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const label = formatYM(yearMonth);
    const scheduleLabel = `${schedule.holidays}例${schedule.rest_days}休`;
    const header = [
        '\uFEFF' + label + ' 薪資報表（' + scheduleLabel + '）',
        '',
        ['姓名', '分店', '計薪方式', '底薪', '出勤天數/工時', '休息日加班費', '國定假日加給', '勞保', '健保', '實領金額', '備註'].map(q).join(','),
    ];

    const rows = employees.map(emp => {
        const rec = payrollMap[emp.id];
        if (!rec) {
            return [emp.name, emp.store_name, typeLabel(emp.type), emp.base_salary, '（未完成）', '', '', '', '', '', ''].map(q).join(',');
        }

        const baseSalaryDisplay = emp.type === 'hourly' ? `${rec.base_salary}/hr` : rec.base_salary;
        const attendanceDisplay = emp.type === 'monthly' || emp.type === 'mixed'
            ? `${rec.working_days}天`
            : `${rec.hours_worked}hr`;

        const earnedBase =
            emp.type === 'monthly' ? Math.round(rec.base_salary / 30) * rec.working_days :
                emp.type === 'mixed' ? Math.round(rec.base_salary / 30) * rec.working_days + rec.extra_hours * rec.extra_hourly_rate :
                    rec.base_salary * rec.hours_worked;

        const externalTotal = earnedBase
            + (rec.rest_day_pay || 0)
            + (rec.holiday_pay || 0)
            + (rec.bonus_growth || 0)
            + (rec.bonus_sqc || 0)
            + (rec.transport || 0)
            - (rec.labor || 0)
            - (rec.health || 0);

        return [
            emp.name,
            emp.store_name,
            typeLabel(emp.type),
            baseSalaryDisplay,
            attendanceDisplay,
            rec.rest_day_pay > 0 ? rec.rest_day_pay : '',
            rec.holiday_pay > 0 ? rec.holiday_pay : '',
            rec.labor > 0 ? -rec.labor : 0,
            rec.health > 0 ? -rec.health : 0,
            externalTotal,
            rec.note || '',
        ].map(q).join(',');
    });

    return [...header, ...rows, '', `匯出時間: ${new Date().toLocaleString('zh-TW')}`].join('\n');
}

// ─── Labor Inspection CSV ─────────────────────────────────────────────────────

function buildLaborCSV(
    employees: Employee[],
    laborMap: Record<string, LaborInspectionRecord>
): string {
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const cols = ['姓名', '分店', '計薪方式', '薪資', '工時', '休息日加班費', '國定假日加給', '應領金額', '勞保', '健保', '實領金額', '員工簽名'];
    const header = ['\uFEFF員工清冊', '', cols.map(q).join(',')];

    const rows = employees.map(emp => {
        const rec = laborMap[emp.id];
        if (!rec?.pay_type) {
            return [emp.name, emp.store_name, '', '', '', '', '', '', '', '', '', ''].map(q).join(',');
        }
        const isHourly = rec.pay_type === 'hourly';
        const salaryDisplay = isHourly ? `${rec.base_salary}/hr` : rec.base_salary;
        const hoursDisplay = isHourly ? rec.hours_worked : '';
        return [
            emp.name,
            emp.store_name,
            isHourly ? '時薪' : '月薪',
            salaryDisplay,
            hoursDisplay,
            rec.rest_day_days > 0 ? Math.round(rec.rest_day_days * (isHourly ? rec.base_salary : rec.base_salary / 30 / 8) * (2 * 1.34 + 6 * 1.67)) : '',
            isHourly
                ? (rec.holiday_days > 0 ? Math.round(rec.base_salary * 8 * rec.holiday_days) : '')
                : (rec.holiday_hours > 0 ? Math.round((rec.base_salary / 30 / 8) * rec.holiday_hours) : ''),
            rec.gross_pay,
            rec.labor > 0 ? -rec.labor : 0,
            rec.health > 0 ? -rec.health : 0,
            rec.net_pay,
            '',
        ].map(q).join(',');
    });

    return [...header, ...rows, '', `匯出時間: ${new Date().toLocaleString('zh-TW')}`].join('\n');
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F2F7' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { textAlign: 'center', color: '#8E8E93', marginTop: 40 },

    monthBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 8, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    monthArrow: { padding: 12 },
    monthArrowText: { fontSize: 26, color: '#007AFF', fontWeight: '300' },
    monthCenter: { flex: 1, alignItems: 'center' },
    monthText: { fontSize: 20, fontWeight: 'bold', color: '#1C1C1E' },
    monthTotal: { fontSize: 13, color: '#34C759', fontWeight: '600', marginTop: 2 },

    tabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
    tabBtn: { flex: 1, paddingVertical: 11, alignItems: 'center' },
    tabBtnActive: { borderBottomWidth: 2, borderBottomColor: '#007AFF' },
    tabBtnText: { fontSize: 15, color: '#8E8E93', fontWeight: '500' },
    tabBtnTextActive: { color: '#007AFF', fontWeight: '700' },

    batchBtn: { margin: 16, marginBottom: 4, backgroundColor: '#FF9500', borderRadius: 10, padding: 12, alignItems: 'center' },
    batchBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

    card: { backgroundColor: '#fff', marginBottom: 10, padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    empName: { fontSize: 17, fontWeight: 'bold', color: '#1C1C1E' },
    empSub: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
    paidAmt: { fontSize: 13, color: '#34C759', fontWeight: '600', marginTop: 3 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
    badgePaid: { backgroundColor: '#34C75920' },
    badgeUnpaid: { backgroundColor: '#F2F2F7' },
    statusText: { fontSize: 12, fontWeight: 'bold' },
    statusPaid: { color: '#34C759' },
    statusUnpaid: { color: '#8E8E93' },

    // Labor inspection
    laborSalary: { fontSize: 17, fontWeight: 'bold', color: '#5856D6' },
    laborEmpty: { fontSize: 14, color: '#8E8E93' },
    laborEdit: { fontSize: 12, color: '#8E8E93', marginTop: 2 },

    modalScroll: { flex: 1, backgroundColor: '#F2F2F7', padding: 20, paddingTop: 56 },
    navBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    navBack: { color: '#007AFF', fontSize: 16 },
    saveBtn: { backgroundColor: '#007AFF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
    saveBtnText: { color: '#fff', fontWeight: 'bold' },
    modalTitle: { fontSize: 26, fontWeight: 'bold', color: '#1C1C1E' },
    modalSub: { fontSize: 14, color: '#8E8E93', marginTop: 4, marginBottom: 20 },

    section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14 },
    sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 10 },
    hint: { fontSize: 12, color: '#8E8E93', marginBottom: 10 },

    calendar: { marginTop: 4 },
    calWeekRow: { flexDirection: 'row', marginBottom: 4 },
    calWeekLabel: { flex: 1, textAlign: 'center', fontSize: 12, color: '#8E8E93', fontWeight: '600' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 6, padding: 1 },
    calOff: { backgroundColor: '#E3F2FD' },
    calLeave: { backgroundColor: '#FFF3E0' },
    calDayNum: { fontSize: 13, color: '#1C1C1E', fontWeight: '500' },
    calOffText: { color: '#1565C0' },
    calLeaveText: { color: '#E65100' },
    calStatus: { fontSize: 9, fontWeight: 'bold', lineHeight: 11 },

    groupLabel: { fontSize: 12, color: '#8E8E93', marginTop: 14, marginBottom: 6, fontWeight: '600' },
    basePayBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 8, padding: 12, marginTop: 6 },
    basePayLabel: { fontSize: 14, color: '#555' },
    basePayValue: { fontSize: 18, fontWeight: 'bold', color: '#007AFF' },
    calcHint: { backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4 },
    calcHintText: { fontSize: 12, color: '#2E7D32' },
    insBox: { flexDirection: 'row', gap: 12, backgroundColor: '#F2F2F7', borderRadius: 8, padding: 10, marginBottom: 6 },
    insText: { fontSize: 13, color: '#555' },
    salaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F2F2F7' },
    salaryLabel: { fontSize: 14, color: '#444', flex: 1 },
    salaryInput: { fontSize: 15, color: '#1C1C1E', minWidth: 80, borderBottomWidth: 1, borderColor: '#007AFF', paddingVertical: 2 },
    noteInput: { borderWidth: 1, borderColor: '#E5E5EA', borderRadius: 8, padding: 10, fontSize: 14, color: '#1C1C1E', minHeight: 60, marginTop: 4 },

    netPayBox: { backgroundColor: '#1C1C1E', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 14 },
    netPayLabel: { fontSize: 13, color: '#8E8E93', marginBottom: 6 },
    netPayValue: { fontSize: 40, fontWeight: 'bold', color: '#34C759' },

    printBtn: { backgroundColor: '#34C759', borderRadius: 14, padding: 18, alignItems: 'center', marginBottom: 40 },
    printBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    printBtnSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3 },

    scheduleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E5E5EA' },
    scheduleLabel: { fontSize: 14, color: '#8E8E93', marginRight: 8 },
    scheduleValue: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1C1C1E' },
    scheduleEdit: { fontSize: 13, color: '#007AFF' },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
    scheduleCard: { backgroundColor: '#fff', borderRadius: 16, padding: 24, width: '80%' },
    scheduleCardTitle: { fontSize: 17, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 20, textAlign: 'center' },
    scheduleInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    scheduleInputLabel: { flex: 1, fontSize: 15, color: '#3C3C43' },
    scheduleInput: { width: 64, borderWidth: 1, borderColor: '#C7C7CC', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 16 },
    scheduleHint: { fontSize: 12, color: '#8E8E93', marginBottom: 20, lineHeight: 18 },
    scheduleActions: { flexDirection: 'row', gap: 12 },
    scheduleCancelBtn: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#C7C7CC', alignItems: 'center' },
    scheduleCancelText: { fontSize: 15, color: '#3C3C43' },
    scheduleSaveBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#007AFF', alignItems: 'center' },
    scheduleSaveText: { fontSize: 15, color: '#fff', fontWeight: '600' },

    // Batch action buttons row
    actionRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
    actionBtn: { flex: 1, borderRadius: 10, padding: 11, alignItems: 'center' },
    actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

    // Print selection mode
    printModeBar: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12, marginBottom: 4, alignItems: 'center' },
    printSelectAllBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#007AFF' },
    printSelectAllText: { color: '#007AFF', fontWeight: '600', fontSize: 14 },
    printConfirmBtn: { flex: 1, backgroundColor: '#34C759', borderRadius: 10, padding: 11, alignItems: 'center' },
    printConfirmText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
    printCancelBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F2F2F7' },
    printCancelText: { color: '#3C3C43', fontWeight: '500', fontSize: 14 },

    // Checkbox
    checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#C7C7CC', marginRight: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
    checkboxChecked: { borderColor: '#34C759', backgroundColor: '#34C759' },
    checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

    // Labor pay type toggle
    laborTypeBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#C7C7CC', alignItems: 'center' },
    laborTypeBtnActive: { borderColor: '#5856D6', backgroundColor: '#5856D620' },
    laborTypeBtnText: { fontSize: 15, color: '#8E8E93', fontWeight: '500' },
    laborTypeBtnTextActive: { color: '#5856D6', fontWeight: '700' },

    // Copy previous month
    copyPrevBtn: { backgroundColor: '#EAF4FF', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: '#007AFF' },
    copyPrevText: { color: '#007AFF', fontWeight: '600', fontSize: 14 },

    // Auto-fill insurance hint
    autoFillHint: { backgroundColor: '#FFF9E6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6, borderWidth: 1, borderColor: '#FFD60A' },
    autoFillHintText: { fontSize: 12, color: '#7A5F00' },
});
