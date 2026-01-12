# AWS Cognito Setup Guide for Admin Access

Since we have enabled strict security for the Admin Panel, you must manually assign the **ADMIN** role to your user in the AWS Console.

## Step 1: Create the ADMIN Group
1.  Log in to the **[AWS Management Console](https://console.aws.amazon.com/cognito)**.
2.  Go to **Amazon Cognito** > **User pools**.
3.  Select your user pool: **`flight-system-users`** (or similar).
4.  Go to the **Groups** tab.
5.  Click **Create group**.
6.  Enter the Group name: `ADMIN` (Must be exactly this, uppercase).
7.  Click **Create group**.

## Step 2: Add Your User to the Group
1.  Go to the **Users** tab in your User Pool.
2.  Click on the user you want to use as an Admin (the one you registered with).
3.  Scroll down to **Group memberships**.
4.  Click **Add user to group**.
5.  Select the `ADMIN` group.
6.  Click **Add**.

## Step 3: Test Login
1.  Go back to your local Admin Panel: `http://localhost:5173`.
2.  Try to log in with that user.
3.  You should now be allowed in!

> **Note:** Any user *not* in this group will get an "Access denied" error when trying to log in to the Admin Panel.
