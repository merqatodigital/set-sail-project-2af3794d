import { useCms } from "@/context/CmsContext";
import { Hero } from "@/components/site/Hero";
import { PartnerDashboard } from "@/components/dashboard/PartnerDashboard";
import { FeatureStrip } from "@/components/site/FeatureStrip";
import { WorkspaceSection, KitchenSection, FocusSection } from "@/components/site/ContentSections";
import { StaySection } from "@/components/site/StaySection";
import { FacilitiesSection } from "@/components/site/FacilitiesSection";
import { SpeedSection } from "@/components/site/SpeedSection";
import { RoomsSection } from "@/components/site/RoomsSection";
import { PricingSection } from "@/components/site/PricingSection";
import { TestimonialsSection, FaqSection } from "@/components/site/TestimonialsFaq";
import { CtaSection } from "@/components/site/CtaFooter";
import { InvestmentTeaser } from "@/components/site/InvestmentTeaser";
import type { SectionKey } from "@/types/cms";

const SECTION_MAP: Record<SectionKey, React.ComponentType> = {
  hero: Hero,
  features: FeatureStrip,
  workspace: WorkspaceSection,
  kitchen: KitchenSection,
  focus: FocusSection,
  stay: StaySection,
  facilities: FacilitiesSection,
  speed: SpeedSection,
  rooms: RoomsSection,
  pricing: PricingSection,
  testimonials: TestimonialsSection,
  faqs: FaqSection,
  cta: CtaSection,
  investment: InvestmentTeaser,
};

export default function Home() {
  const { data } = useCms();
  const order = [...data.homepage.sectionOrder].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/*
        PARTNER DASHBOARD HERO
        ----------------------
        The owner asked for the partner dashboard to be the first thing seen at
        "/", so it is rendered explicitly here and the CMS "hero" section is
        filtered out of the ordered list below. That keeps two guarantees:
          • the dashboard always renders first, whatever the CMS order says
          • src/components/site/Hero.tsx is untouched, so reverting is a one
            line change: delete the filter below and remove <PartnerDashboard />.
      */}
      <PartnerDashboard />

      {order.map((section) => {
        if (section.key === "hero") return null;
        if (!section.visible) return null;
        const Component = SECTION_MAP[section.key];
        if (!Component) return null;
        return <Component key={section.key} />;
      })}
    </div>
  );
}
