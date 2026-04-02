import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    updateDoc,
} from "firebase/firestore";
import React, { useEffect, useState } from 'react';
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
    View
} from 'react-native';
import { db } from '../constants/firebaseConfig';

interface Store {
    id: string;
    name: string;
}

interface Employee {
    id: string;
    name: string;
    phone: string;
    id_number: string;
    store_name: string;
    type: 'monthly' | 'hourly' | 'mixed';
    base_salary: number;
    is_insured_here: boolean;
    start_date: string;
}

interface SalaryRecord {
    id: string;
    base_salary: number;
    effective_date: string;
    note: string;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EmployeeManager() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [stores, setStores] = useState<Store[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedStores, setSelectedStores] = useState<string[]>([]);
    const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        const unsubEmp = onSnapshot(
            query(collection(db, "employees"), orderBy("store_name", "asc")),
            (snap) => {
                setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
                setLoading(false);
            }
        );
        const unsubStores = onSnapshot(
            query(collection(db, "stores"), orderBy("name", "asc")),
            (snap) => {
                setStores(snap.docs.map(d => ({ id: d.id, ...d.data() } as Store)));
            }
        );
        return () => { unsubEmp(); unsubStores(); };
    }, []);

    const toggleStore = (name: string) => {
        setSelectedStores(prev =>
            prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]
        );
    };

    const filteredEmployees = selectedStores.length === 0
        ? employees
        : employees.filter(e => selectedStores.includes(e.store_name));

    const storeNames = stores.map(s => s.name);

    if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#007AFF" /></View>;

    return (
        <View style={s.container}>
            {/* Header */}
            <View style={s.header}>
                <Text style={s.title}>人員管理</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[s.headerBtn, { backgroundColor: '#5856D6' }]} onPress={() => setShowSettings(true)}>
                        <Text style={s.headerBtnText}>⚙️ 設定</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.headerBtn} onPress={() => setShowAddModal(true)}>
                        <Text style={s.headerBtnText}>+ 新增</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Store Filter Checkboxes */}
            <View style={s.filterRow}>
                <Text style={s.filterLabel}>篩選：</Text>
                {stores.map(store => {
                    const checked = selectedStores.includes(store.name);
                    return (
                        <TouchableOpacity key={store.id} style={s.filterItem} onPress={() => toggleStore(store.name)}>
                            <View style={[s.filterBox, checked && s.filterBoxChecked]}>
                                {checked && <Text style={s.filterCheck}>✓</Text>}
                            </View>
                            <Text style={[s.filterText, checked && s.filterTextChecked]}>{store.name}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            <Text style={s.countText}>{filteredEmployees.length} 位員工</Text>

            {/* Employee List */}
            <FlatList
                data={filteredEmployees}
                keyExtractor={item => item.id}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
                renderItem={({ item }) => (
                    <TouchableOpacity style={s.card} onPress={() => setSelectedEmp(item)}>
                        <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={s.empName}>{item.name}</Text>
                                {item.is_insured_here && (
                                    <View style={s.insuredBadge}>
                                        <Text style={s.insuredBadgeText}>投保</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={s.empStore}>{item.store_name}</Text>
                            <Text style={s.empSalary}>
                                {item.type === 'monthly' ? '月薪' : item.type === 'hourly' ? '時薪' : '月薪＋時薪'} ${item.base_salary.toLocaleString()}{item.type === 'hourly' ? '/hr' : ''}
                            </Text>
                        </View>
                        <Text style={s.chevron}>›</Text>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={s.emptyText}>尚無員工資料</Text>}
            />

            {showAddModal && (
                <AddEmployeeModal storeNames={storeNames} onClose={() => setShowAddModal(false)} />
            )}
            {selectedEmp && (
                <EmployeeDetailModal
                    employee={selectedEmp}
                    storeNames={storeNames}
                    onClose={() => setSelectedEmp(null)}
                    onDeleted={() => setSelectedEmp(null)}
                />
            )}
            <SettingsModal visible={showSettings} onClose={() => setShowSettings(false)} />
        </View>
    );
}

// ─── Add Employee Modal ───────────────────────────────────────────────────────

function AddEmployeeModal({ storeNames, onClose }: { storeNames: string[]; onClose: () => void }) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [idNumber, setIdNumber] = useState('');
    const [store, setStore] = useState(storeNames[0] ?? '');
    const [type, setType] = useState<'monthly' | 'hourly' | 'mixed'>('monthly');
    const [baseSalary, setBaseSalary] = useState('');
    const [isInsured, setIsInsured] = useState(true);
    const [startDate, setStartDate] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!name.trim() || !baseSalary) return Alert.alert("錯誤", "請填寫姓名與薪資金額");
        if (!store) return Alert.alert("錯誤", "請先在設定中新增分店");
        setSaving(true);
        try {
            const salary = parseFloat(baseSalary);
            const date = startDate.trim() || new Date().toISOString().split('T')[0];
            const empRef = await addDoc(collection(db, "employees"), {
                name: name.trim(), phone: phone.trim(), id_number: idNumber.trim(),
                store_name: store, type, base_salary: salary,
                is_insured_here: isInsured, start_date: date, updated_at: new Date(),
            });
            await addDoc(collection(db, "employees", empRef.id, "salary_history"), {
                base_salary: salary, effective_date: date, note: "入職薪資",
            });
            onClose();
        } catch (e: any) {
            Alert.alert("錯誤", e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible animationType="slide">
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                <Text style={s.modalTitle}>新增員工</Text>

                <Text style={s.label}>姓名 *</Text>
                <TextInput style={s.input} value={name} onChangeText={setName} placeholder="員工姓名" />

                <Text style={s.label}>電話</Text>
                <TextInput style={s.input} value={phone} onChangeText={setPhone} placeholder="0912-345-678" keyboardType="phone-pad" />

                <Text style={s.label}>身分證字號</Text>
                <TextInput style={s.input} value={idNumber} onChangeText={setIdNumber} placeholder="A123456789" autoCapitalize="characters" />

                <Text style={s.label}>入職日期</Text>
                <TextInput style={s.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD（空白=今天）" />

                <Text style={s.label}>分店</Text>
                <View style={s.chipRow}>
                    {storeNames.map(st => (
                        <TouchableOpacity key={st} style={[s.chip, store === st && s.chipActive]} onPress={() => setStore(st)}>
                            <Text style={store === st ? s.chipTextActive : s.chipText}>{st}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <Text style={s.label}>計薪方式</Text>
                <View style={s.typeRow}>
                    <TouchableOpacity style={[s.typeBtn, type === 'monthly' && s.typeBtnActive]} onPress={() => setType('monthly')}>
                        <Text style={type === 'monthly' ? s.typeTextActive : s.typeText}>月薪制</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.typeBtn, type === 'hourly' && s.typeBtnActive]} onPress={() => setType('hourly')}>
                        <Text style={type === 'hourly' ? s.typeTextActive : s.typeText}>時薪制</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.typeBtn, type === 'mixed' && s.typeBtnActive]} onPress={() => setType('mixed')}>
                        <Text style={type === 'mixed' ? s.typeTextActive : s.typeText}>月＋時薪</Text>
                    </TouchableOpacity>
                </View>

                <Text style={s.label}>{type === 'monthly' ? '月薪金額 *' : '時薪金額 *'}</Text>
                <TextInput style={s.input} value={baseSalary} onChangeText={setBaseSalary} keyboardType="numeric" placeholder={type === 'monthly' ? '28000' : '183'} />

                <TouchableOpacity style={s.checkRow} onPress={() => setIsInsured(!isInsured)}>
                    <View style={[s.checkbox, isInsured && s.checkboxActive]} />
                    <Text style={{ marginLeft: 10, fontSize: 15 }}>勞健保投保在公司</Text>
                </TouchableOpacity>

                <View style={s.modalBtns}>
                    <TouchableOpacity style={s.cancelBtn} onPress={onClose}><Text>取消</Text></TouchableOpacity>
                    <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                        <Text style={s.saveBtnText}>{saving ? '儲存中...' : '確認新增'}</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </Modal>
    );
}

// ─── Employee Detail Modal ────────────────────────────────────────────────────

function EmployeeDetailModal({ employee, storeNames, onClose, onDeleted }: {
    employee: Employee;
    storeNames: string[];
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(employee.name);
    const [phone, setPhone] = useState(employee.phone || '');
    const [idNumber, setIdNumber] = useState(employee.id_number || '');
    const [store, setStore] = useState(employee.store_name);
    const [type, setType] = useState(employee.type);
    const [isInsured, setIsInsured] = useState(employee.is_insured_here);
    const [startDate, setStartDate] = useState(employee.start_date || '');
    const [salaryHistory, setSalaryHistory] = useState<SalaryRecord[]>([]);
    const [showAdjust, setShowAdjust] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getDocs(query(
            collection(db, "employees", employee.id, "salary_history"),
            orderBy("effective_date", "desc")
        )).then(snap => {
            setSalaryHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as SalaryRecord)));
        });
    }, [employee.id]);

    const saveEdit = async () => {
        setSaving(true);
        try {
            await updateDoc(doc(db, "employees", employee.id), {
                name: name.trim(), phone: phone.trim(), id_number: idNumber.trim(),
                store_name: store, type, is_insured_here: isInsured,
                start_date: startDate.trim(), updated_at: new Date(),
            });
            setEditing(false);
        } catch (e: any) {
            Alert.alert("錯誤", e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        Alert.alert(
            "確認刪除",
            `確定要刪除「${employee.name}」的所有資料嗎？此操作無法復原。`,
            [
                { text: "取消", style: "cancel" },
                {
                    text: "刪除", style: "destructive",
                    onPress: async () => {
                        await deleteDoc(doc(db, "employees", employee.id));
                        onDeleted();
                    }
                }
            ]
        );
    };

    return (
        <Modal visible animationType="slide">
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                <View style={s.navBar}>
                    <TouchableOpacity onPress={onClose}>
                        <Text style={s.navBack}>‹ 返回</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => editing ? saveEdit() : setEditing(true)}>
                        <Text style={s.navAction}>
                            {saving ? '儲存中...' : editing ? '完成' : '編輯'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <Text style={s.modalTitle}>{employee.name}</Text>

                <View style={s.section}>
                    <Text style={s.sectionTitle}>基本資料</Text>
                    <InfoRow label="姓名" value={name} editing={editing} onChange={setName} />
                    <InfoRow label="電話" value={phone} editing={editing} onChange={setPhone} keyboard="phone-pad" />
                    <InfoRow label="身分證" value={idNumber} editing={editing} onChange={setIdNumber} caps="characters" />
                    <InfoRow label="入職日期" value={startDate} editing={editing} onChange={setStartDate} placeholder="YYYY-MM-DD" />

                    {editing ? (
                        <>
                            <Text style={s.label}>分店</Text>
                            <View style={s.chipRow}>
                                {storeNames.map(st => (
                                    <TouchableOpacity key={st} style={[s.chip, store === st && s.chipActive]} onPress={() => setStore(st)}>
                                        <Text style={store === st ? s.chipTextActive : s.chipText}>{st}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <Text style={s.label}>計薪方式</Text>
                            <View style={s.typeRow}>
                                <TouchableOpacity style={[s.typeBtn, type === 'monthly' && s.typeBtnActive]} onPress={() => setType('monthly')}>
                                    <Text style={type === 'monthly' ? s.typeTextActive : s.typeText}>月薪制</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[s.typeBtn, type === 'hourly' && s.typeBtnActive]} onPress={() => setType('hourly')}>
                                    <Text style={type === 'hourly' ? s.typeTextActive : s.typeText}>時薪制</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[s.typeBtn, type === 'mixed' && s.typeBtnActive]} onPress={() => setType('mixed')}>
                                    <Text style={type === 'mixed' ? s.typeTextActive : s.typeText}>月＋時薪</Text>
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity style={s.checkRow} onPress={() => setIsInsured(!isInsured)}>
                                <View style={[s.checkbox, isInsured && s.checkboxActive]} />
                                <Text style={{ marginLeft: 10, fontSize: 15 }}>勞健保投保在公司</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <InfoRow label="分店" value={store} editing={false} onChange={() => { }} />
                            <InfoRow label="計薪" value={type === 'monthly' ? '月薪制' : '時薪制'} editing={false} onChange={() => { }} />
                            <InfoRow label="投保" value={isInsured ? '是' : '否'} editing={false} onChange={() => { }} />
                        </>
                    )}
                </View>

                <View style={s.section}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={s.sectionTitle}>薪資</Text>
                        <TouchableOpacity style={s.adjustBtn} onPress={() => setShowAdjust(true)}>
                            <Text style={s.adjustBtnText}>調薪</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={s.currentSalaryBox}>
                        <Text style={s.currentSalaryLabel}>目前{employee.type === 'monthly' ? '月薪' : '時薪'}</Text>
                        <Text style={s.currentSalaryValue}>${employee.base_salary.toLocaleString()}</Text>
                    </View>
                    <Text style={[s.label, { marginTop: 16 }]}>薪資異動紀錄</Text>
                    {salaryHistory.length === 0 ? (
                        <Text style={s.emptyText}>尚無紀錄</Text>
                    ) : (
                        salaryHistory.map(record => (
                            <View key={record.id} style={s.historyRow}>
                                <View>
                                    <Text style={s.historyDate}>{record.effective_date}</Text>
                                    <Text style={s.historyNote}>{record.note || '—'}</Text>
                                </View>
                                <Text style={s.historyAmount}>${record.base_salary.toLocaleString()}</Text>
                            </View>
                        ))
                    )}
                </View>

                <TouchableOpacity style={s.deleteBtn} onPress={handleDelete}>
                    <Text style={s.deleteBtnText}>刪除此員工</Text>
                </TouchableOpacity>
            </ScrollView>

            {showAdjust && (
                <AdjustSalaryModal
                    employee={employee}
                    onClose={() => setShowAdjust(false)}
                    onSaved={(newRecord) => {
                        setSalaryHistory(prev => [newRecord, ...prev]);
                        setShowAdjust(false);
                    }}
                />
            )}
        </Modal>
    );
}

// ─── Adjust Salary Modal ──────────────────────────────────────────────────────

function AdjustSalaryModal({ employee, onClose, onSaved }: {
    employee: Employee;
    onClose: () => void;
    onSaved: (record: SalaryRecord) => void;
}) {
    const [newSalary, setNewSalary] = useState(employee.base_salary.toString());
    const [effectiveDate, setEffectiveDate] = useState('');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!newSalary) return Alert.alert("錯誤", "請填寫新薪資");
        setSaving(true);
        try {
            const salary = parseFloat(newSalary);
            const date = effectiveDate.trim() || new Date().toISOString().split('T')[0];
            const histRef = await addDoc(
                collection(db, "employees", employee.id, "salary_history"),
                { base_salary: salary, effective_date: date, note: note.trim() }
            );
            await updateDoc(doc(db, "employees", employee.id), {
                base_salary: salary, updated_at: new Date(),
            });
            onSaved({ id: histRef.id, base_salary: salary, effective_date: date, note: note.trim() });
        } catch (e: any) {
            Alert.alert("錯誤", e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible animationType="slide" transparent>
            <View style={s.overlay}>
                <View style={s.adjustContainer}>
                    <Text style={s.modalTitle}>調薪 — {employee.name}</Text>
                    <Text style={s.label}>新薪資金額</Text>
                    <TextInput style={s.input} value={newSalary} onChangeText={setNewSalary} keyboardType="numeric" />
                    <Text style={s.label}>生效日期</Text>
                    <TextInput style={s.input} value={effectiveDate} onChangeText={setEffectiveDate} placeholder="YYYY-MM-DD（空白=今天）" />
                    <Text style={s.label}>備註</Text>
                    <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="例：2025年調薪" />
                    <View style={s.modalBtns}>
                        <TouchableOpacity style={s.cancelBtn} onPress={onClose}><Text>取消</Text></TouchableOpacity>
                        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                            <Text style={s.saveBtnText}>確認調薪</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, editing, onChange, keyboard, caps, placeholder }: {
    label: string; value: string; editing: boolean;
    onChange: (v: string) => void;
    keyboard?: any; caps?: any; placeholder?: string;
}) {
    return (
        <View style={s.infoRow}>
            <Text style={s.infoLabel}>{label}</Text>
            {editing ? (
                <TextInput
                    style={s.infoInput} value={value} onChangeText={onChange}
                    keyboardType={keyboard || 'default'} autoCapitalize={caps || 'none'}
                    placeholder={placeholder || ''}
                />
            ) : (
                <Text style={s.infoValue}>{value || '—'}</Text>
            )}
        </View>
    );
}

// ─── Settings Modal (分店管理 + 保費級距) ──────────────────────────────────────

function SettingsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const [stores, setStores] = useState<Store[]>([]);
    const [newStoreName, setNewStoreName] = useState('');
    const [tiers, setTiers] = useState<any[]>([]);

    useEffect(() => {
        if (!visible) return;
        getDocs(query(collection(db, "stores"), orderBy("name", "asc")))
            .then(snap => setStores(snap.docs.map(d => ({ id: d.id, ...d.data() } as Store))));
        getDocs(query(collection(db, "insurance_tiers"), orderBy("min", "asc")))
            .then(snap => setTiers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, [visible]);

    const addStore = async () => {
        const name = newStoreName.trim();
        if (!name) return;
        const ref = await addDoc(collection(db, "stores"), { name });
        setStores(prev => [...prev, { id: ref.id, name }].sort((a, b) => a.name.localeCompare(b.name)));
        setNewStoreName('');
    };

    const removeStore = (store: Store) => {
        Alert.alert(
            "刪除分店",
            `確定刪除「${store.name}」？請確認該分店已無員工。`,
            [
                { text: "取消", style: "cancel" },
                {
                    text: "刪除", style: "destructive",
                    onPress: async () => {
                        await deleteDoc(doc(db, "stores", store.id));
                        setStores(prev => prev.filter(s => s.id !== store.id));
                    }
                }
            ]
        );
    };

    const updateTier = async (id: string, field: string, value: string) => {
        const num = parseFloat(value) || 0;
        await updateDoc(doc(db, "insurance_tiers", id), { [field]: num });
    };

    return (
        <Modal visible={visible} animationType="slide">
            <ScrollView style={s.modalScroll} keyboardShouldPersistTaps="handled">
                <View style={s.navBar}>
                    <View />
                    <TouchableOpacity onPress={onClose}>
                        <Text style={s.navAction}>完成</Text>
                    </TouchableOpacity>
                </View>
                <Text style={s.modalTitle}>設定</Text>

                {/* 分店管理 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>分店管理</Text>
                    {stores.map(store => (
                        <View key={store.id} style={s.storeRow}>
                            <Text style={s.storeRowName}>{store.name}</Text>
                            <TouchableOpacity onPress={() => removeStore(store)}>
                                <Text style={s.storeRowDelete}>刪除</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                    <View style={s.addStoreRow}>
                        <TextInput
                            style={s.addStoreInput}
                            value={newStoreName}
                            onChangeText={setNewStoreName}
                            placeholder="新分店名稱"
                            returnKeyType="done"
                            onSubmitEditing={addStore}
                        />
                        <TouchableOpacity style={s.addStoreBtn} onPress={addStore}>
                            <Text style={s.addStoreBtnText}>新增</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* 保費級距 */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>保費級距</Text>
                    {tiers.map((t, i) => (
                        <View key={t.id} style={s.tierRow}>
                            <Text style={s.tierLabel}>第 {i + 1} 級 (≦ ${t.max})</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.smallLabel}>勞保扣款</Text>
                                    <TextInput style={s.smallInput} keyboardType="numeric" defaultValue={t.labor.toString()} onEndEditing={(e) => updateTier(t.id, 'labor', e.nativeEvent.text)} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.smallLabel}>健保扣款</Text>
                                    <TextInput style={s.smallInput} keyboardType="numeric" defaultValue={t.health.toString()} onEndEditing={(e) => updateTier(t.id, 'health', e.nativeEvent.text)} />
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </Modal>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F2F2F7' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
    title: { fontSize: 24, fontWeight: 'bold', color: '#1C1C1E' },
    headerBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#007AFF' },
    headerBtnText: { color: '#fff', fontWeight: 'bold' },

    filterRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12, flexWrap: 'wrap' },
    filterLabel: { fontSize: 13, color: '#8E8E93' },
    filterItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    filterBox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: '#C7C7CC', justifyContent: 'center', alignItems: 'center' },
    filterBoxChecked: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
    filterCheck: { color: '#fff', fontSize: 11, fontWeight: 'bold', lineHeight: 14 },
    filterText: { fontSize: 13, color: '#8E8E93' },
    filterTextChecked: { color: '#007AFF', fontWeight: '600' },
    countText: { fontSize: 13, color: '#8E8E93', paddingHorizontal: 16, marginBottom: 4 },

    card: {
        backgroundColor: '#fff', marginBottom: 10, padding: 16, borderRadius: 12,
        flexDirection: 'row', alignItems: 'center',
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2
    },
    empName: { fontSize: 17, fontWeight: 'bold', color: '#1C1C1E' },
    empStore: { fontSize: 13, color: '#8E8E93', marginTop: 3 },
    empSalary: { fontSize: 14, color: '#007AFF', marginTop: 3, fontWeight: '500' },
    insuredBadge: { backgroundColor: '#34C75920', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
    insuredBadgeText: { color: '#34C759', fontSize: 11, fontWeight: 'bold' },
    chevron: { fontSize: 22, color: '#C7C7CC' },
    emptyText: { textAlign: 'center', color: '#8E8E93', marginTop: 40 },

    modalScroll: { flex: 1, backgroundColor: '#F2F2F7', padding: 24, paddingTop: 60 },
    modalTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#1C1C1E' },
    label: { fontSize: 13, color: '#8E8E93', marginTop: 14, marginBottom: 6 },
    input: { borderBottomWidth: 1, borderColor: '#E5E5EA', paddingVertical: 10, fontSize: 16, color: '#1C1C1E', backgroundColor: 'transparent' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#F2F2F7' },
    chipActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
    chipText: { color: '#444', fontSize: 13 },
    chipTextActive: { color: '#fff', fontSize: 13 },
    typeRow: { flexDirection: 'row', gap: 10 },
    typeBtn: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#ddd' },
    typeBtnActive: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
    typeText: { color: '#333' },
    typeTextActive: { color: '#fff', fontWeight: 'bold' },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
    checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: '#007AFF', borderRadius: 6 },
    checkboxActive: { backgroundColor: '#007AFF' },
    modalBtns: { flexDirection: 'row', gap: 10, marginTop: 30, marginBottom: 40 },
    cancelBtn: { flex: 1, padding: 15, alignItems: 'center', borderRadius: 10, backgroundColor: '#E5E5EA' },
    saveBtn: { flex: 2, padding: 15, alignItems: 'center', borderRadius: 10, backgroundColor: '#007AFF' },
    saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

    navBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    navBack: { color: '#007AFF', fontSize: 16 },
    navAction: { color: '#007AFF', fontSize: 16, fontWeight: 'bold' },

    section: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
    sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 12 },
    infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F2F2F7' },
    infoLabel: { width: 70, fontSize: 14, color: '#8E8E93' },
    infoValue: { flex: 1, fontSize: 15, color: '#1C1C1E' },
    infoInput: { flex: 1, fontSize: 15, color: '#1C1C1E', borderBottomWidth: 1, borderColor: '#007AFF', paddingVertical: 4 },

    adjustBtn: { backgroundColor: '#FF9500', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
    adjustBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
    currentSalaryBox: { backgroundColor: '#F2F2F7', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 12 },
    currentSalaryLabel: { fontSize: 13, color: '#8E8E93' },
    currentSalaryValue: { fontSize: 34, fontWeight: 'bold', color: '#007AFF', marginTop: 4 },
    historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F2F2F7' },
    historyDate: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
    historyNote: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
    historyAmount: { fontSize: 16, fontWeight: 'bold', color: '#34C759' },

    deleteBtn: { margin: 16, marginTop: 0, padding: 15, borderRadius: 12, backgroundColor: '#FF3B3015', alignItems: 'center' },
    deleteBtnText: { color: '#FF3B30', fontWeight: 'bold', fontSize: 15 },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    adjustContainer: { width: '90%', backgroundColor: '#fff', borderRadius: 20, padding: 24 },

    // Store management
    storeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F2F2F7' },
    storeRowName: { fontSize: 15, color: '#1C1C1E' },
    storeRowDelete: { color: '#FF3B30', fontSize: 14 },
    addStoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
    addStoreInput: { flex: 1, borderBottomWidth: 1, borderColor: '#E5E5EA', paddingVertical: 8, fontSize: 15 },
    addStoreBtn: { backgroundColor: '#007AFF', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
    addStoreBtnText: { color: '#fff', fontWeight: 'bold' },

    // Insurance tiers
    tierRow: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 10, marginBottom: 10 },
    tierLabel: { fontWeight: 'bold', marginBottom: 8, color: '#1C1C1E' },
    smallLabel: { fontSize: 11, color: '#8E8E93' },
    smallInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', padding: 5, borderRadius: 5, marginTop: 2 },
});
