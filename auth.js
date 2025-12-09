/* محرك النظام - auth.js
   JavaScript only + localStorage
   يعرض الكائن window.Auth
*/

(function (global) {
  const STORAGE_KEYS = {
    USERS: "jsys_users",
    RUNS: "jsys_runs",
    BILLS: "jsys_bills",
    SESSIONS: "jsys_sessions",
  };

  // أدوات مساعدة
  function now() {
    return new Date().toISOString();
  }
  function uid(prefix = "") {
    return prefix + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }
  function load(key) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }
  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // قراءة/كتابة مجموعات البيانات
  function getUsers() {
    return load(STORAGE_KEYS.USERS) || [];
  }
  function setUsers(users) {
    save(STORAGE_KEYS.USERS, users);
  }
  function getRuns() {
    return load(STORAGE_KEYS.RUNS) || [];
  }
  function setRuns(runs) {
    save(STORAGE_KEYS.RUNS, runs);
  }
  function getBills() {
    return load(STORAGE_KEYS.BILLS) || [];
  }
  function setBills(bills) {
    save(STORAGE_KEYS.BILLS, bills);
  }
  function getSession() {
    return load(STORAGE_KEYS.SESSIONS) || { currentUserId: null };
  }
  function setSession(session) {
    save(STORAGE_KEYS.SESSIONS, session);
  }

  // قاعدة: تهيئة إن لم تكن موجودة
  function initDefaults() {
    if (!load(STORAGE_KEYS.USERS)) {
      // مثال مستخدم تجريبي (كلمة المرور: "1234")
      const demo = {
        id: uid("u_"),
        phone: "0123456789",
        password: "1234",
        balance: 1000,
        dailyProfit: 0,
        teamProfit: 0,
        inviterCode: "INV-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
        inviterId: null,
        createdAt: now(),
      };
      setUsers([demo]);
    }
    if (!load(STORAGE_KEYS.RUNS)) setRuns([]);
    if (!load(STORAGE_KEYS.BILLS)) setBills([]);
    if (!load(STORAGE_KEYS.SESSIONS)) setSession({ currentUserId: null });
  }

  // وظائف المستخدمين
  function findUserByPhone(phone) {
    return getUsers().find(u => u.phone === phone) || null;
  }
  function findUserById(id) {
    return getUsers().find(u => u.id === id) || null;
  }
  function findUserByInviterCode(code) {
    if (!code) return null;
    return getUsers().find(u => u.inviterCode === code) || null;
  }

  function saveUser(user) {
    const users = getUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx === -1) users.push(user);
    else users[idx] = user;
    setUsers(users);
  }

  function generateInviterCode() {
    return "INV-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  // تسجيل
  function signup({ phone, password, inviterCode = null }) {
    if (!phone || !password) throw new Error("رقم الهاتف وكلمة المرور مطلوبان");
    if (findUserByPhone(phone)) throw new Error("مستخدم بهذا الهاتف موجود بالفعل");
    const inviter = findUserByInviterCode(inviterCode);
    const newUser = {
      id: uid("u_"),
      phone,
      password,
      balance: 0,
      dailyProfit: 0,
      teamProfit: 0,
      inviterCode: generateInviterCode(),
      inviterId: inviter ? inviter.id : null,
      createdAt: now(),
    };
    const users = getUsers();
    users.push(newUser);
    setUsers(users);
    // فاتورة تسجيل (اختياري)
    addBill(newUser.id, "signup", 0, { note: "New signup" });
    return newUser;
  }

  // تسجيل الدخول / الجلسة
  function login(phone, password) {
    const user = findUserByPhone(phone);
    if (!user) throw new Error("المستخدم غير موجود");
    if (user.password !== password) throw new Error("كلمة المرور خاطئة");
    const session = getSession();
    session.currentUserId = user.id;
    setSession(session);
    return user;
  }
  function logout() {
    const session = getSession();
    session.currentUserId = null;
    setSession(session);
  }
  function getCurrentUser() {
    const session = getSession();
    if (!session.currentUserId) return null;
    return findUserById(session.currentUserId) || null;
  }

  // فواتير (bills)
  // type: deposit, withdraw, ai_profit, referral, signup, other
  function addBill(userId, type, amount, meta = {}) {
    const bills = getBills();
    const bill = {
      id: uid("b_"),
      userId,
      type,
      amount,
      timestamp: now(),
      meta,
    };
    bills.push(bill);
    setBills(bills);
    return bill;
  }

  function getBillsForUser(userId) {
    return getBills().filter(b => b.userId === userId).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
  }

  // تشغيل AI Power
  function runAIPower(userId, options = {}) {
    // options: {minProfit, maxProfit}
    const min = typeof options.minProfit === "number" ? options.minProfit : 1;
    const max = typeof options.maxProfit === "number" ? options.maxProfit : 100;
    const profit = Math.round((Math.random() * (max - min) + min) * 100) / 100; // رقم عشري بدقة سنتان
    // تحديث رصيد المستخدم
    const user = findUserById(userId);
    if (!user) throw new Error("المستخدم غير موجود");
    user.balance = Number((user.balance + profit).toFixed(2));
    user.dailyProfit = Number((user.dailyProfit + profit).toFixed(2));
    saveUser(user);
    // سجل التشغيل
    const runs = getRuns();
    const run = {
      id: uid("r_"),
      userId,
      timestamp: now(),
      profitAmount: profit,
    };
    runs.push(run);
    setRuns(runs);
    // فاتورة للربح
    addBill(userId, "ai_profit", profit, { note: "AI Power run" });
    // توزيع الدعوات
    distributeReferralProfits(userId, profit);
    return run;
  }

  // توزيع ربح الدعوات لثلاثة مستويات
  function distributeReferralProfits(childUserId, profitAmount) {
    const PERCENTS = [0.20, 0.05, 0.02]; // جيل1، جيل2، جيل3
    let current = findUserById(childUserId);
    // صعود في السلسلة: inviterId من childUser, ثم inviter of inviter, ...
    for (let level = 0; level < 3; level++) {
      if (!current || !current.inviterId) break;
      const inviter = findUserById(current.inviterId);
      if (!inviter) break;
      const share = Number((profitAmount * PERCENTS[level]).toFixed(2));
      if (share > 0) {
        inviter.balance = Number((inviter.balance + share).toFixed(2));
        inviter.teamProfit = Number((inviter.teamProfit + share).toFixed(2));
        saveUser(inviter);
        addBill(inviter.id, "referral", share, {
          fromUserId: childUserId,
          level: level + 1,
          note: `Referral reward level ${level + 1}`,
        });
      }
      current = inviter;
    }
  }

  // سجلات التشغيل
  function getRunsForUser(userId) {
    return getRuns().filter(r => r.userId === userId).sort((a,b) => b.timestamp.localeCompare(a.timestamp));
  }

  // عرض الفريق (ثلاث أجيال)
  function getTeam(userId) {
    const users = getUsers();
    const gen1 = users.filter(u => u.inviterId === userId);
    const gen1Ids = gen1.map(u => u.id);
    const gen2 = users.filter(u => gen1Ids.includes(u.inviterId));
    const gen2Ids = gen2.map(u => u.id);
    const gen3 = users.filter(u => gen2Ids.includes(u.inviterId));
    return {
      gen1,
      gen2,
      gen3,
    };
  }

  // إيداع (وهمي)
  function deposit(userId, amount) {
    amount = Number(amount);
    if (!userId || typeof amount !== "number" || amount <= 0) throw new Error("مبلغ غير صالح");
    const user = findUserById(userId);
    if (!user) throw new Error("المستخدم غير موجود");
    user.balance = Number((user.balance + amount).toFixed(2));
    saveUser(user);
    addBill(userId, "deposit", amount, { note: "Fake deposit" });
    return user;
  }

  // سحب (وهمي) مع تحقق من الرصيد
  function withdraw(userId, amount) {
    amount = Number(amount);
    if (!userId || typeof amount !== "number" || amount <= 0) throw new Error("مبلغ غير صالح");
    const user = findUserById(userId);
    if (!user) throw new Error("المستخدم غير موجود");
    if (user.balance < amount) throw new Error("الرصيد غير كافٍ");
    user.balance = Number((user.balance - amount).toFixed(2));
    saveUser(user);
    addBill(userId, "withdraw", -Math.abs(amount), { note: "Fake withdraw" });
    return user;
  }

  // مساعدة لتحديث المستخدم الحالي (بعد تغييرات)
  function refreshCurrentUser() {
    const session = getSession();
    if (!session.currentUserId) return null;
    return findUserById(session.currentUserId);
  }

  // وظائف إدارة: إعادة تهيئة (اختياري)
  function resetAllData() {
    localStorage.removeItem(STORAGE_KEYS.USERS);
    localStorage.removeItem(STORAGE_KEYS.RUNS);
    localStorage.removeItem(STORAGE_KEYS.BILLS);
    localStorage.removeItem(STORAGE_KEYS.SESSIONS);
    initDefaults();
  }

  // تهيئة تلقائية عند تحميل الملف
  initDefaults();

  // كشف ال API للعالم
  const API = {
    // init: الاختيارية لأن initDefaults استدعيت تلقائياً
    init: initDefaults,
    signup,
    login,
    logout,
    getCurrentUser,
    getUserById: findUserById,
    generateInviterCode,
    runAIPower,
    getRunsForUser,
    getTeam,
    deposit,
    withdraw,
    getBillsForUser,
    addBill,
    resetAllData,
    // للاختبار/التطوير
    _internal: {
      getUsers,
      getRuns,
      getBills,
      getSession,
      saveUser,
    },
  };

  global.Auth = API;
})(window);
