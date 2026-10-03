import configuration from './legalOperator.json';

// Public operator details. Populate only from verified company information.
export const legalOperator = configuration;
export const LEGAL_IDENTITY_READY = configuration.identityVerified
  && configuration.contactsVerified
  && !!configuration.legalName.trim()
  && !!configuration.registrationNumber.trim()
  && !!configuration.registeredAddress.trim();

export const LIABILITY_NOTICE = 'Лески Каручка, екипът и свързаните с оператора лица отговарят за своите действия и задължения съгласно приложимия закон. За изпълнението на превоза отговаря съответният превозвач. Ограниченията в Общите условия се прилагат само доколкото законът ги допуска и не засягат задължителните ви права.';
