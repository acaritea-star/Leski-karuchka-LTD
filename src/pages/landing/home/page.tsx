import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Trust from './components/Trust';
import NewsSection from './components/NewsSection';
import SecondaryCta from './components/SecondaryCta';

export default function LandingHome() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Trust />
      <NewsSection />
      <SecondaryCta />
    </>
  );
}