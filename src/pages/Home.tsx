import { useCms } from "@/context/CmsContext";
import { Hero } from "@/components/site/Hero";
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
      {order.map((section) => {
        if (!section.visible) return null;
        const Component = SECTION_MAP[section.key];
        if (!Component) return null;
        return <Component key={section.key} />;
      })}
    </div>
  );
}
