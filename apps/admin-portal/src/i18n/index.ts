import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  ar: {
    translation: {
      common: {
        loading: "جارٍ التحميل...",
        error: "خطأ",
        retry: "إعادة المحاولة",
        back: "رجوع",
        cancel: "إلغاء",
        submit: "إرسال",
        submitting: "جارٍ الإرسال...",
        empty: "لا توجد بيانات",
        search: "بحث",
        filter: "تصفية",
        all: "الكل",
        actions: "إجراءات",
        status: "الحالة",
        created_at: "تاريخ الإنشاء",
      },
      nav: {
        dashboard: "لوحة التحكم",
        users: "المستخدمون",
        drivers: "السائقون",
        orders: "الطلبات",
        audit: "سجل التدقيق",
      },
      dashboard: {
        title: "لوحة التحكم",
        active_users: "المستخدمون النشطون",
        available_drivers: "السائقون المتاحون",
        today_orders: "طلبات اليوم",
        revenue: "الإيرادات",
        pending_documents: "وثائق قيد المراجعة",
        open_disputes: "نزاعات مفتوحة",
      },
      session: {
        login: "تسجيل الدخول",
        logout: "تسجيل الخروج",
        username: "اسم المستخدم",
        password: "كلمة المرور",
        login_failed: "فشل تسجيل الدخول",
      },
    },
  },
  en: {
    translation: {
      common: {
        loading: "Loading...",
        error: "Error",
        retry: "Retry",
        back: "Back",
        cancel: "Cancel",
        submit: "Submit",
        submitting: "Submitting...",
        empty: "No data",
        search: "Search",
        filter: "Filter",
        all: "All",
        actions: "Actions",
        status: "Status",
        created_at: "Created At",
      },
      nav: {
        dashboard: "Dashboard",
        users: "Users",
        drivers: "Drivers",
        orders: "Orders",
        audit: "Audit Log",
      },
      dashboard: {
        title: "Dashboard",
        active_users: "Active Users",
        available_drivers: "Available Drivers",
        today_orders: "Today's Orders",
        revenue: "Revenue",
        pending_documents: "Pending Documents",
        open_disputes: "Open Disputes",
      },
      session: {
        login: "Login",
        logout: "Logout",
        username: "Username",
        password: "Password",
        login_failed: "Login failed",
      },
    },
  },
  ur: {
    translation: {
      common: {
        loading: "لوڈ ہو رہا ہے...",
        error: "خرابی",
        retry: "دوبارہ کوشش",
        back: "واپس",
        cancel: "منسوخ",
        submit: "جمع کرائیں",
        submitting: "جمع کر رہا ہے...",
        empty: "کوئی ڈیٹا نہیں",
        search: "تلاش",
        filter: "فلٹر",
        all: "تمام",
        actions: "اقدامات",
        status: "حالت",
        created_at: "تاریخ تخلیق",
      },
      nav: {
        dashboard: "ڈیش بورڈ",
        users: "صارفین",
        drivers: "ڈرائیورز",
        orders: "آرڈرز",
        audit: "آڈٹ لاگ",
      },
      dashboard: {
        title: "ڈیش بورڈ",
        active_users: "فعال صارفین",
        available_drivers: "دستیاب ڈرائیورز",
        today_orders: "آج کے آرڈرز",
        revenue: "آمدنی",
        pending_documents: "زیر توثیق دستاویزات",
        open_disputes: "کھلے تنازعات",
      },
      session: {
        login: "لاگ ان",
        logout: "لاگ آؤٹ",
        username: "صارف نام",
        password: "پاس ورڈ",
        login_failed: "لاگ ان ناکام",
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "ar",
  fallbackLng: "ar",
  interpolation: { escapeValue: false },
});

export default i18n;
