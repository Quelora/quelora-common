/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

module.exports = ({ title, body, actionUrl, actionText, language = 'en' }) => {
    const colors = {
        primary: '#1fa8f5',
        text: '#333333',
        background: '#F4F6F8',
        container: '#FFFFFF',
        secondaryText: '#8899A6',
        border: '#EEEEEE'
    };

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: ${colors.text}; background-color: ${colors.background}; }
                .wrapper { max-width: 600px; margin: 20px auto; background-color: ${colors.container}; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
                .header { background-color: ${colors.primary}; padding: 20px 40px; text-align: center; }
                .header-logo { font-size: 24px; font-weight: bold; color: #FFFFFF; text-decoration: none; display: inline-block; }
                .content { padding: 40px; text-align: left; }
                .message-body { font-size: 16px; margin-bottom: 30px; color: ${colors.text}; }
                
                /* CTA Button */
                .button-container { text-align: center; margin: 35px 0; }
                .button { background-color: ${colors.primary}; color: #ffffff !important; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block; }
                
                /* Fallback Link for accessibility/plain-text preference */
                .fallback-link { margin-top: 25px; font-size: 12px; color: ${colors.secondaryText}; text-align: center; word-break: break-all; }
                .fallback-link a { color: ${colors.primary}; text-decoration: none; }
                
                .footer { background-color: ${colors.container}; padding: 30px; text-align: center; font-size: 12px; color: ${colors.secondaryText}; border-top: 1px solid ${colors.border}; }
                .footer a { color: ${colors.secondaryText}; text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="wrapper">
                <div class="header">
                    <a href="${actionUrl || '#'}" class="header-logo">Quelora</a>
                </div>
                
                <div class="content">
                    <h2 style="margin-top: 0; font-weight: 600; font-size: 20px;">${title}</h2>
                    
                    <div class="message-body">
                        ${body}
                    </div>

                    ${actionUrl ? `
                    <div class="button-container">
                        <a href="${actionUrl}" class="button" target="_blank">${actionText || 'Ver Detalles'}</a>
                    </div>
                    <div class="fallback-link">
                        <p style="margin: 0;">Si el botón no funciona, copia este enlace:</p>
                        <a href="${actionUrl}">${actionUrl}</a>
                    </div>
                    ` : ''}
                </div>

                <div class="footer">
                    <p>&copy; ${new Date().getFullYear()} Quelora. Todos los derechos reservados.</p>
                    <p>
                        <a href="#">Preferencias de notificación</a> | 
                        <a href="#">Política de Privacidad</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
};