import configuration from './legalOperator.json';

// Public controller and contact details supplied by the responsible person.
// Company verification and the wider release prerequisites remain separate.
export const legalOperator = configuration;
export const dataController = { ...configuration.dataController, email: configuration.email };
export const LEGAL_IDENTITY_READY = configuration.identityVerified
  && configuration.contactsVerified
  && !!configuration.legalName.trim()
  && !!configuration.registrationNumber.trim()
  && !!configuration.registeredAddress.trim();

export const LIABILITY_NOTICE = 'Лески Каручка е цифров посредник, който свързва клиенти с водачи и таксиметрови компании. Платформата не извършва превоза и не е страна по договора за превоз. За изпълнението му отговаря съответният превозвач. Ограниченията на отговорността за Лески Каручка, екипа и свързаните лица са описани в Общите условия и не засягат задължителните законови права.';
