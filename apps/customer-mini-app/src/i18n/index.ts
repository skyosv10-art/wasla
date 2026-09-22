import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// ADR-044 Decision 6: react-i18next with JSON message catalogs.
// Arabic is the default locale (RTL), English and Urdu are secondary.

const resources = {
  ar: {
    translation: {
      appName: "وَصْلة",
      home: {
        ride: "اطلب مشوار",
        delivery: "اطلب توصيل",
        marketplace: "تصفح المتاجر",
        search: "ابحث",
        myOrders: "طلباتي",
        reputation: "سمعتي",
        profile: "حسابي",
      },
      common: {
        loading: "جارٍ التحميل...",
        error: "حدث خطأ",
        retry: "إعادة المحاولة",
        cancel: "إلغاء",
      },
      session: {
        expired: "انتهت الجلسة، يرجى إعادة الدخول",
      },
    },
  },
  en: {
    translation: {
      appName: "Wasla",
      home: {
        ride: "Request a ride",
        delivery: "Request delivery",
        marketplace: "Browse stores",
        search: "Search",
        myOrders: "My Orders",
        reputation: "My Reputation",
        profile: "My Profile",
      },
      common: {
        loading: "Loading...",
        error: "An error occurred",
        retry: "Retry",
        cancel: "Cancel",
      },
      session: {
        expired: "Session expired, please re-enter",
      },
    },
  },
  ur: {
    translation: {
      appName: "وصلة",
      home: {
        ride: "سواری طلب کریں",
        delivery: "ڈیلیوری طلب کریں",
        marketplace: "اسٹورز دیکھیں",
        search: "تلاش کریں",
        myOrders: "میری درخواستیں",
        reputation: "میری ساکھ",
        profile: "میری پروفائل",
      },
      common: {
        loading: "لوڈ ہو رہا ہے...",
        error: "ایک خامی پیش آئی",
        retry: "دوبارہ کوشش کریں",
        cancel: "منسوخ کریں",
      },
      session: {
        expired: "سیشن ختم ہو گیا، دوبارہ داخل ہوں",
      },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "ar",
  fallbackLng: "ar",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
