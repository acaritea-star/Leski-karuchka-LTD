// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
const fake=vi.hoisted(()=>({user:{id:'alice',role:'CUSTOMER'},preference:true as boolean|null,enabled:false,
 permission:'granted',enabling:false,supported:true,enable:vi.fn().mockResolvedValue(true),unregister:vi.fn().mockResolvedValue(true)}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:fake.user})}));
vi.mock('@/hooks/usePushNotifications',()=>({usePushNotifications:()=>fake}));
vi.mock('@/lib/pushSubscription',()=>({getPushPreference:()=>fake.preference,pushSupported:()=>fake.supported}));
import NotificationSettings from './NotificationSettings';
import EnableNotificationsBanner from './EnableNotificationsBanner';
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();fake.user={id:'alice',role:'CUSTOMER'};fake.preference=true;
 fake.enabled=false;fake.permission='granted';fake.enabling=false;fake.supported=true;});
afterEach(cleanup);
it('keeps a saved choice on while delivery is restoring and lets the switch turn it off',async()=>{
 render(<NotificationSettings />);const toggle=screen.getByRole('switch');
 expect(toggle.getAttribute('aria-checked')).toBe('true');expect(screen.getByRole('status').textContent).toContain('Изборът ти е запазен');
 fireEvent.click(toggle);await act(async()=>{});
 expect(fake.unregister).toHaveBeenCalledWith('alice');expect(fake.enable).not.toHaveBeenCalled();
});
it.each(['denied','unsupported'])('allows an opt-out even when the browser is %s',async state=>{
 fake.permission=state==='denied'?'denied':'granted';fake.supported=state!=='unsupported';
 render(<NotificationSettings />);const toggle=screen.getByRole('switch');expect(toggle.hasAttribute('disabled')).toBe(false);
 fireEvent.click(toggle);await act(async()=>{});expect(fake.unregister).toHaveBeenCalledWith('alice');
});
it('can repair delivery from Settings without toggling off the saved choice',async()=>{
 render(<NotificationSettings />);fireEvent.click(screen.getByRole('button',{name:'Възстанови връзката'}));await act(async()=>{});
 expect(fake.enable).toHaveBeenCalledWith('alice');expect(fake.unregister).not.toHaveBeenCalled();
});
it.each([true,false])('does not re-solicit a saved %s notification decision on login',preference=>{
 fake.preference=preference;render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
});
it('keeps dismissal scoped to its account when a new account arrives',()=>{
 fake.preference=null;fake.permission='default';const view=render(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Отказ'}));expect(screen.queryByLabelText('Настройка на известията')).toBeNull();
 fake.user={id:'bob',role:'CUSTOMER'};view.rerender(<MemoryRouter><EnableNotificationsBanner /></MemoryRouter>);
 expect(screen.getByLabelText('Настройка на известията')).toBeTruthy();
});
