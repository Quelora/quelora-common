/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

const validatePasswordStrength = (password) => {
  // Longitud mínima
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }

  // Contiene al menos una mayúscula
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter' };
  }

  // Contiene al menos una minúscula
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter' };
  }

  // Contiene al menos un número
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number' };
  }

  // Contiene al menos un carácter especial
  if (!/[\W_]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character' };
  }
  return { valid: true };
};

module.exports = { validatePasswordStrength };