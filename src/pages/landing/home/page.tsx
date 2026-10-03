import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hasStoredSession } from '@/lib/supabase';
import AppRedirect from '@/pages/home/page';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Trust from './components/Trust';
import NewsSection from './components/NewsSection';
import SecondaryCta from './components/SecondaryCta';

export default function LandingHome() {
  const { session, loading } = useAuth();
  const [returning] = useState(hasStoredSession);
  if (session || loading && returning) return <AppRedirect />;
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