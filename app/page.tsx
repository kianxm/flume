import { FlumeApp } from "@/components/app/FlumeApp";
import { FAQS, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

// Structured data for search engines: what the site is, and the questions
// answered on the page (kept in step with the visible text via FAQS).
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: `${SITE_URL}/`,
      description: SITE_DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      image: `${SITE_URL}/opengraph-image.png`,
      featureList: [
        "Sankey chart of income, expenses and savings",
        "Works from a CSV or a pasted AI agent reply",
        "Runs in the browser with no sign-up or bank login",
        "PNG export in landscape and portrait",
        "Option to show percentages in place of amounts",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so no text in the data can close the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <FlumeApp />
    </>
  );
}
