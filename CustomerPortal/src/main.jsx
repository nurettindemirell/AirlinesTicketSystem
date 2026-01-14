import React from 'react'
import ReactDOM from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import awsConfig from './aws-exports'
import App from './App.jsx'
import './index.css'            


Amplify.configure(awsConfig);

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
