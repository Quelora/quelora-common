/*
 * Quelora — quelora-common
 * Copyright (C) 2026 Germán Zelaya — https://quelora.org
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This file is part of Quelora. See the LICENSE file for terms.
 */

/* quelora-common/templates/emails/verificationTemplate.js */
module.exports = ({ title, body, actionUrl, actionText = 'Verify Account' }) => {
    // Definición de colores clave de tu paleta 'light' para incrustar en el CSS del email
    const primaryColor = '#1fa8f5'; // --quelora-primary-color
    const primaryTextColor = '#333'; // --quelora-primary-text-color
    const backgroundColor = '#FFFAFA'; // --quelora-background-color
    const containerColor = '#FFFFFF'; // --quelora-bw-background-color
    const textColor = '#333'; // --quelora-text-color
    const lightGrayColor = '#999'; // --quelora-light-gray-color

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                /* Reset and basic styles */
                body {
                    margin: 0;
                    padding: 0;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
                    line-height: 1.6;
                    color: ${textColor};
                    background-color: ${backgroundColor};
                }

                /* Main email container */
                .wrapper {
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: ${containerColor};
                    border-radius: 8px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
                    overflow: hidden;
                }

                /* Header */
                .header {
                    background-color: ${primaryColor};
                    padding: 20px 40px;
                    text-align: center;
                }
                .header-logo {
                    font-size: 24px;
                    font-weight: bold;
                    color: #ffffff;
                    text-decoration: none;
                    display: inline-block;
                }

                /* Content Body */
                .content {
                    padding: 40px;
                    text-align: left;
                }
                h1, h2, h3 {
                    color: ${primaryTextColor};
                    margin-top: 0;
                }
                p {
                    margin-bottom: 20px;
                }

                /* Button Style (CTA) */
                .button-container {
                    text-align: center;
                    margin: 30px 0;
                }
                .button {
                    display: inline-block;
                    padding: 12px 25px;
                    font-size: 16px;
                    font-weight: bold;
                    color: #ffffff !important; /* Important to override mail client styles */
                    background-color: ${primaryColor};
                    border-radius: 6px;
                    text-decoration: none;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    transition: background-color 0.3s ease;
                }

                /* Footer */
                .footer {
                    background-color: ${backgroundColor};
                    color: ${lightGrayColor};
                    padding: 30px 40px;
                    text-align: center;
                    font-size: 12px;
                    border-top: 1px solid #eee;
                }
                .footer-links {
                    margin-bottom: 15px;
                }
                .footer-link {
                    color: ${lightGrayColor};
                    text-decoration: none;
                    margin: 0 10px;
                }
                .social-icon {
                    width: 20px;
                    height: 20px;
                    margin: 0 5px;
                    display: inline-block;
                    color: ${lightGrayColor};
                    text-decoration: none;
                    font-size: 14px;
                }
                .unsubscribe {
                    margin-top: 15px;
                    display: block;
                }
                .unsubscribe a {
                    color: ${lightGrayColor};
                    text-decoration: underline;
                }
                
            </style>
        </head>
        <body>
            <div role="article" aria-label="${title}" lang="en" style="padding: 20px 0;">
                <div class="wrapper">
                    
                    <div class="header">
                        <a href="#" class="header-logo">Quelora</a>
                    </div>

                    <div class="content">
                        ${body}
                        
                        ${actionUrl ? `
                            <div class="button-container">
                                <a href="${actionUrl}" class="button" target="_blank">${actionText}</a>
                            </div>
                            <p style="text-align: center; font-size: 14px; color: ${lightGrayColor};">If the button does not work, please copy and paste the following link into your browser:</p>
                            <p style="text-align: center; font-size: 12px; word-break: break-all;"><a href="${actionUrl}" style="color: ${primaryColor};">${actionUrl}</a></p>
                        ` : ''}

                    </div>

                    <div class="footer">
                        <div class="footer-links">
                            <a href="#" class="footer-link">Support</a>
                            <span style="color: ${lightGrayColor};">|</span>
                            <a href="#" class="footer-link">Privacy Policy</a>
                            <span style="color: ${lightGrayColor};">|</span>
                            <a href="#" class="footer-link">Terms of Service</a>
                        </div>
                        
                        <div>
                            <a href="#" class="social-icon" title="Facebook">f</a>
                            <a href="#" class="social-icon" title="Twitter">t</a>
                            <a href="#" class="social-icon" title="Instagram">i</a>
                        </div>

                        <p style="margin: 15px 0 0; line-height: 1.4; color: ${lightGrayColor}; font-size: 12px;">
                            You received this email because you signed up for Quelora. <br>
                            &copy; ${new Date().getFullYear()} Quelora. All rights reserved.
                        </p>
                        
                        <a href="#" class="unsubscribe" style="color: ${lightGrayColor};">Unsubscribe</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
};