import { MapPin, Phone, Mail, MessageCircle, Sparkles, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useCms } from "@/context/CmsContext";
import { safeHref, safeMailto, safeTel } from "@/lib/security";
import { openTalaIntent } from "@/components/tala/talaOpen";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { Reveal } from "./Reveal";
import { InstagramIcon, FacebookIcon, YoutubeIcon } from "./SocialIcons";

// Keyboard-focus treatment shared by every footer control. WCAG 2.4.7 requires
// a visible focus indicator on all interactive elements; a hover style alone
// leaves keyboard and switch users with no idea where they are.
const FOCUS_RING =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C6A15B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141210]";

export function CtaSection() {
  const { data } = useCms();
  const home = data.homepage;

  return (
    <section className="relative overflow-hidden bg-[#1B1812] py-16 sm:py-20 lg:py-28">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle at 30% 20%, #C6A15B 0%, transparent 55%)",
        }}
      />
      <div className="relative mx-auto flex max-w-[1400px] flex-col items-center gap-6 px-5 text-center sm:gap-8 sm:px-6 lg:px-12">
        <Reveal>
          <h2 className="font-serif text-3xl font-light leading-[1.1] text-white sm:text-4xl lg:text-6xl">
            {home.ctaTitle}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            {home.ctaSubtext}
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
            <button
              type="button"
              onClick={() =>
                openTalaIntent(
                  "room_booking",
                  { interest: "long_stay", source: "closing_cta" },
                  "Hi TALA! I'd like to check availability for an extended stay.",
                )
              }
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-[#C6A15B] px-6 text-[13px] font-medium tracking-wide text-[#221D14] shadow-[0_6px_20px_rgba(198,161,91,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:bg-[#D9BA80] hover:shadow-[0_10px_28px_rgba(198,161,91,0.55),inset_0_1px_0_rgba(255,255,255,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#1B1812] active:scale-[0.98] sm:h-14 sm:px-8 sm:text-sm"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>{home.ctaButtonLabel}</span>
            </button>
            <Link
              to="/portal"
              className="group inline-flex h-12 items-center gap-2 rounded-full border border-[#C6A15B]/40 bg-[#C6A15B]/10 px-6 text-[13px] font-medium tracking-wide text-[#C6A15B] transition-all duration-200 hover:bg-[#C6A15B]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C6A15B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1B1812] active:scale-[0.98] sm:h-14 sm:px-8 sm:text-sm"
            >
              <User className="h-4 w-4" aria-hidden="true" />
              <span>Guest Portal</span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * True when a social field holds an actual profile URL. The CMS defaults ship
 * bare platform domains (e.g. "https://instagram.com") which are placeholders
 * rather than destinations, so they count as "not configured" and no icon is
 * rendered — a control that leads nowhere is worse than no control.
 */
function isRealSocialUrl(href: string): boolean {
  const safe = safeHref(href, "");
  if (!safe) return false;
  try {
    return new URL(safe).pathname.replace(/\/+$/, "").length > 0;
  } catch {
    return false;
  }
}

export function Footer() {
  const { data } = useCms();
  const c = data.settings.contact;

  const socials = [
    { href: c.social.instagram, Icon: InstagramIcon, label: "Instagram" },
    { href: c.social.facebook, Icon: FacebookIcon, label: "Facebook" },
    { href: c.social.youtube, Icon: YoutubeIcon, label: "YouTube" },
  ].filter(({ href }) => isRealSocialUrl(href));

  return (
    <footer className="bg-[#141210] text-white/70">
      {/* pb-24 on mobile gives enough clearance so the fixed WhatsApp button
          (bottom-4, h-12 ≈ 64px total) never overlaps the footer bottom row. */}
      <div className="mx-auto w-full max-w-[1400px] px-5 pb-20 pt-12 sm:px-6 sm:pb-16 sm:pt-14 lg:px-12 lg:pb-20 lg:pt-16">
        {/*
          Layout strategy:
          - mobile (base): brand on top, then Explore + Contact side-by-side (2 cols)
            to keep the footer compact instead of stretched vertically, then a
            full-width Booking block at the bottom.
          - tablet (sm): same 2-col rhythm — brand spans 2, Explore/Contact each
            take one column, Booking spans 2 for a balanced grid.
          - desktop (lg): 4 uniform columns, all top-aligned.
        */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-4 lg:gap-8">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-1">
            <p className="font-serif text-base font-medium tracking-[0.18em] text-white sm:text-lg lg:text-xl">
              {data.settings.logoText}
            </p>
            <p className="mt-2.5 max-w-xs text-[13px] leading-relaxed text-white/50 sm:mt-3 sm:text-sm">
              {data.settings.tagline}
            </p>
            {socials.length > 0 && (
              <div className="mt-5 flex gap-2.5">
                {socials.map(({ href, Icon, label }) => (
                  <a
                    key={label}
                    href={safeHref(href, "")}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${label} (opens in a new tab)`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 transition-colors hover:border-[#C6A15B] hover:text-[#C6A15B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C6A15B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#141210]"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Explore */}
          <nav aria-label="Footer" className="min-w-0">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 sm:mb-4 sm:text-xs">
              Explore
            </h2>
            <ul className="space-y-2 text-[13px] sm:space-y-2.5 sm:text-sm">
              <li>
                <a href="#workspace" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Workspace
                </a>
              </li>
              <li>
                <a href="#kitchen" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Kitchen
                </a>
              </li>
              <li>
                <a href="#accommodation" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Stay
                </a>
              </li>
              <li>
                <a href="#pricing" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Pricing
                </a>
              </li>
              <li>
                <Link to="/blog" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Blog
                </Link>
              </li>
              <li>
                <Link to="/investment" className={`hover:text-[#C6A15B] ${FOCUS_RING}`}>
                  Investment
                </Link>
              </li>
            </ul>
          </nav>

          {/* Contact */}
          <div className="min-w-0">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 sm:mb-4 sm:text-xs">
              Contact
            </h2>
            {/* <address> is the semantic container for contact details, so
                assistive tech and search engines can identify the block. */}
            <address className="not-italic">
              <ul className="space-y-2 text-[13px] sm:space-y-2.5 sm:text-sm">
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#C6A15B]" aria-hidden="true" />
                  <span className="min-w-0 break-words leading-relaxed">{c.address}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-[#C6A15B]" aria-hidden="true" />
                  <a
                    href={safeTel(c.phone)}
                    className={`min-w-0 break-words hover:text-[#C6A15B] ${FOCUS_RING}`}
                  >
                    {c.phone}
                  </a>
                </li>
                <li className="flex items-start gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#C6A15B]" aria-hidden="true" />
                  <a
                    href={safeMailto(c.email)}
                    className={`min-w-0 break-words hover:text-[#C6A15B] ${FOCUS_RING}`}
                    title={c.email}
                  >
                    {c.email}
                  </a>
                </li>
              </ul>
            </address>
          </div>

          {/* Booking */}
          <div className="col-span-2 lg:col-span-1">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55 sm:mb-4 sm:text-xs">
              Booking
            </h2>
            <p className="mb-3 text-[13px] leading-relaxed text-white/60 sm:mb-4 sm:text-sm">
              {c.businessHours}
            </p>
            <button
              type="button"
              onClick={() =>
                openTalaIntent(
                  "general_help",
                  { source: "footer", interest: "general" },
                  "Hi TALA! I'd like to book or ask about availability.",
                )
              }
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#C6A15B] px-5 text-[12px] font-medium tracking-wide text-[#221D14] shadow-[0_2px_10px_rgba(198,161,91,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:bg-[#D9BA80] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#141210] active:scale-[0.98] sm:w-auto"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span>Book with TALA</span>
            </button>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center gap-3 border-t border-white/10 pt-6 text-xs text-white/55 sm:mt-14 sm:flex-row sm:justify-between sm:gap-4 sm:pt-8">
          <Link
            to="/admin"
            className={`order-first flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-white/5 hover:text-white/70 sm:order-none ${FOCUS_RING}`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Admin
          </Link>
          <p className="text-center sm:text-left">
            © {new Date().getFullYear()} {data.settings.siteName}. All rights reserved.
          </p>
          <nav
            aria-label="Legal"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-white/55 sm:justify-start"
          >
            <Link to="/privacy" className={`transition-colors hover:text-white/85 ${FOCUS_RING}`}>
              Privacy Policy
            </Link>
            <Link to="/terms" className={`transition-colors hover:text-white/85 ${FOCUS_RING}`}>
              Terms of Service
            </Link>
            <Link
              to="/accessibility"
              className={`transition-colors hover:text-white/85 ${FOCUS_RING}`}
            >
              Accessibility
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppFloat() {
  const { data } = useCms();
  if (!data.settings.whatsapp.showFloatingButton) return null;
  // Real WhatsApp deep link. TALA has exactly ONE launcher (its own orb) —
  // this green button must never be a second chat launcher.
  const href = buildWhatsAppLink(data.settings.whatsapp, data.settings.contact);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Message us on WhatsApp (opens in a new tab)"
      className="group fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_6px_20px_rgba(37,211,102,0.4)] transition-all duration-200 hover:scale-110 hover:shadow-[0_10px_28px_rgba(37,211,102,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 active:scale-95 sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
    >
      <span className="pointer-events-none absolute inset-0 rounded-full bg-[#25D366]/40 opacity-0 transition-opacity duration-500 group-hover:opacity-75" />
      <MessageCircle className="relative h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
    </a>
  );
}
